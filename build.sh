#!/usr/bin/env bash

# trim_file $file
trim_file() {
  local file=$1;

  cat $file | sed -E "s/import[^;]+;//" > $file.tmp;
  mv $file.tmp $file;
}

yarn vite build

if [[ -d "build/chrome" || -d "build/firefox" ]]; then
  rm -r build/chrome build/firefox
fi
mkdir -p build/chrome build/firefox

cp build/vite/assets/background.*.js build/chrome/background.js
cp build/vite/assets/content_script.*.js build/chrome/content_script.js
cp build/vite/assets/content_script.*.css build/chrome/content_script.css
cp src/assets/*.png build/chrome

trim_file build/chrome/background.js
trim_file build/chrome/content_script.js

cp build/chrome/* build/firefox
cp manifest-chrome.json build/chrome/manifest.json
cp manifest-firefox.json build/firefox/manifest.json
