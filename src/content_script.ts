// @ts-ignore
import Box from './Box.svelte';

setTimeout(() => {
  document.documentElement.classList.add('boxgpt-active');

  const div$ = document.createElement('div');
  div$.classList.add('boxgpt-container');

  document.documentElement.appendChild(div$);
  new Box({target: div$});
}, 10);
