(function () {
  'use strict';
  globalThis.GLT = globalThis.GLT || {};
  const D = { 'hello': 'Sua vez, capit\u00e3o!', 'sunk': 'Afundou o Going Merry!' };
  GLT.T = (k) => (k in D ? D[k] : '[[' + k + ']]');
})();
