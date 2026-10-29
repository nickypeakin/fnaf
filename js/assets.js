// Preloads every image in assets/img (listed in assets-manifest.js) so nothing pops in mid-night.
(function () {
  'use strict';
  const FN = window.FN;
  const LIST = FN.ASSET_LIST || {};
  const url = (name) => `assets/img/${name}.webp`;
  const keep = [];
  let done = 0;
  const total = Object.keys(LIST).length;
  const listeners = [];

  const ready = Promise.all(Object.keys(LIST).map((name) => new Promise((resolve) => {
    const img = new Image();
    keep.push(img);
    img.onload = img.onerror = () => {
      if (!img.naturalWidth) console.warn('image failed to load:', name);
      done++;
      for (const fn of listeners) fn(done, total);
      resolve();
    };
    img.src = url(name);
  })));

  FN.Assets = {
    url,
    ready,
    size: (name) => LIST[name] || [0, 0],
    onProgress(fn) { listeners.push(fn); fn(done, total); },
  };
})();
