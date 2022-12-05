import {v4 as uuidv4} from 'uuid';
import {createParser, ParsedEvent, ReconnectInterval} from 'eventsource-parser';
import Port = chrome.runtime.Port;

// cache

type SimpleCache = {
  get: (key: string) => any;
  set: (key: string, value: any, expire?: number) => void;
}

function newSimpleCache(defaultTimeout: number): SimpleCache {
  const cache = {};
  return {
    get: (key) => cache[key],
    set: (key, value, timeout) => {
      cache[key] = value;
      setTimeout(() => (delete cache[key]), timeout || defaultTimeout);
    },
  };
}

// SSE

async function doSSE(url, options, callback) {
  async function* getStreamIterable(stream: ReadableStream) {
    const reader = stream.getReader();
    try {
      while (true) {
        const {done, value} = await reader.read();
        if (done) {
          return;
        }
        yield value;
      }
    } finally {
      reader.releaseLock();
    }
  }

  function onParse(event: ParsedEvent | ReconnectInterval) {
    if (event.type === 'event') {
      try {
        callback(event.data);
      } catch (error) {
        console.error('error', error, event.data);
      }
    }
  }

  const resp = await fetch(url, options);
  const parser = createParser(onParse);
  for await (const item of getStreamIterable(resp.body)) {
    const s = new TextDecoder().decode(item);
    parser.feed(s);
  }
}

// API

const cache = newSimpleCache(60 * 10);
const keyAccessToken = 'accessToken';
const keyMessageId = 'messageId';

async function getAccessToken(): Promise<string> {
  if (cache.get(keyAccessToken)) {
    return cache.get(keyAccessToken);
  }

  let respJson;
  try {
    const resp = await fetch('https://chat.openai.com/api/auth/session');
    respJson = await resp.json();
  } catch {
  }
  if (!respJson.accessToken) {
    throw new Error('UNAUTHORIZED');
  }
  cache.set(keyAccessToken, respJson.accessToken);
  return respJson.accessToken;
}

async function getAnswer(msgId, question, callback) {
  let accessToken = '';
  try {
    accessToken = await getAccessToken();
  } catch (error) {
    throw new Error('UNAUTHORIZED');
  }
  const parentMessageId = cache.get(keyMessageId) || uuidv4();

  await doSSE('https://chat.openai.com/backend-api/conversation', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      action: 'next',
      messages: [
        {
          id: msgId,
          role: 'user',
          content: {
            content_type: 'text',
            parts: [question],
          },
        },
      ],
      model: 'text-davinci-002-render',
      parent_message_id: parentMessageId,
    }),
  }, (data) => {
    if (data === '[DONE]') {
      callback({type: 'status', status: 'done'});
      return;
    }
    try {
      callback(JSON.parse(data));
    } catch (error) {
      console.error(error);
      callback({error: error?.message || `${error}`});
    }
  })
}

// extension

function postMessage(port: Port, msg, state?: TabState) {
  console.debug('postMessage', msg);
  port.postMessage(msg);

  if (state) {
    appendMessage(state, msg);
  }
}

// messages

function appendMessage(state: TabState, msg) {
  const messages = state.messages;
  if (messages.at(-1)?.status === 'thinking') {
    messages.pop();
  }

  if (msg.message?.id) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].message?.id === msg.message?.id) {
        messages[i] = msg;
        return;
      }
    }
  }
  messages.push(msg);
  state.messages = messages.slice(-10);
}

// main

type TabState = {
  active: boolean;
  port: Port;
  messages: any[];
}

const stateByTabId: Record<string, TabState> = {};

if (chrome.action) {
  chrome.action.onClicked.addListener((tab) => {
    const port = stateByTabId[tab.id]?.port;
    if (port) {
      postMessage(port, {type: 'meta', action: 'toggle'});
    } else {
      console.error('tab not found');
    }
  })
} else {
  console.error('no chrome.action');
}

chrome.runtime.onConnect.addListener((port: Port) => {
  console.debug('onConnect', port);
  const tabId = port.sender?.tab?.id;
  if (tabId) {
    stateByTabId[tabId] = stateByTabId[tabId] || {active: false, port, messages: []};
    stateByTabId[tabId].port = port;

    postMessage(port, {type: 'meta', action: 'set-active', active: stateByTabId[tabId].active});

    // replay messages
    for (const msg of stateByTabId[tabId].messages) {
      postMessage(port, msg, stateByTabId[tabId]);
    }

  } else {
    console.error('no port.sender.tab.id');
  }

  (async () => {
    try {
      await getAccessToken();
      postMessage(port, {type: 'meta', status: 'authorized'});
    } catch {
      postMessage(port, {type: 'meta', status: 'unauthorized'});
    }
  })();

  port.onMessage.addListener(async (msg) => {
    try {
      console.debug('received message', msg);
      if (msg.type === 'meta') {
        if (msg.action === 'login') {
          chrome.tabs.create({url: 'https://chat.openai.com/auth/login'});
        }
        if (msg.action === 'set-active') {
          if (stateByTabId[tabId]) {
            stateByTabId[tabId].active = msg.active;
          }
        }
      }
      if (msg.question) {
        const msgId = uuidv4();
        postMessage(port, {
          type: 'user',
          message: {
            id: uuidv4(),
            content: {
              parts: [msg.question],
            }
          }
        }, stateByTabId[tabId],); // echo
        postMessage(port, {
          type: 'status',
          status: 'thinking',
          message: {
            id: msgId,
            content: {
              parts: ['...'],
            },
          }
        }, stateByTabId[tabId],);
        await getAnswer(msgId, msg.question, (data) => {
          postMessage(port, data, stateByTabId[tabId]);
        });
      }
    } catch (error) {
      console.error('error', error);
      cache.set(keyAccessToken, null);
      if (error.message === 'UNAUTHORIZED') {
        for (const tabId in stateByTabId) {
          try {
            if (stateByTabId[tabId]) {
              postMessage(stateByTabId[tabId].port, {type: 'meta', status: 'unauthorized'});
            }
          } catch {
          }
        }
      }
    }
  })
})
