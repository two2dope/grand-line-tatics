/* GLT.data: static game tables. Area: logic. Contract: ARCHITECTURE.md §3, §5.4.
 * Implemented by the architect. Ids, lengths, format fleets and technique ownership are contract;
 * colours may be tuned by the logic owner. All visible names are i18n keys (resolve with GLT.T). */
(function () {
  'use strict';
  const GLT = (globalThis.GLT = globalThis.GLT || {});

  const ship = (id, len, flag, order) => ({ id, len, flag, order, nameKey: 'ship.' + id + '.name' });

  const ships = {
    mobyDick:      ship('mobyDick', 5, 'whitebeard', 0),
    thousandSunny: ship('thousandSunny', 4, 'strawHat', 1),
    oroJackson:    ship('oroJackson', 4, 'roger', 2),
    redForce:      ship('redForce', 3, 'redHair', 3),
    polarTang:     ship('polarTang', 3, 'heart', 4),
    baratie:       ship('baratie', 3, 'baratie', 5),
    goingMerry:    ship('goingMerry', 2, 'strawHat', 6)
  };
  const shipOrder = ['mobyDick', 'thousandSunny', 'oroJackson', 'redForce', 'polarTang', 'baratie', 'goingMerry'];

  const crew = (id, tech, colors) => ({
    id, tech, flag: id, colors,
    nameKey: 'crew.' + id + '.name',
    captainKey: 'crew.' + id + '.captain',
    officerKeys: ['crew.' + id + '.officer1', 'crew.' + id + '.officer2', 'crew.' + id + '.officer3'],
    tauntKey: 'taunt.' + id
  });

  const crews = {
    strawHat:   crew('strawHat', 'bazooka',
      { primary: '#e23b2e', secondary: '#f2c94c', trim: '#e23b2e', alt: { primary: '#2fa3a0', secondary: '#f2c94c', trim: '#2fa3a0' } }),
    whitebeard: crew('whitebeard', 'tremor',
      { primary: '#eadfc4', secondary: '#6b4aa0', trim: '#eadfc4', alt: { primary: '#6b4aa0', secondary: '#eadfc4', trim: '#6b4aa0' } }),
    redHair:    crew('redHair', 'haki',
      { primary: '#9c1a3a', secondary: '#2b2b2b', trim: '#9c1a3a', alt: { primary: '#d98a1e', secondary: '#2b2b2b', trim: '#d98a1e' } }),
    heart:      crew('heart', 'room',
      { primary: '#f2c230', secondary: '#1f1f2a', trim: '#f2c230', alt: { primary: '#3c8f4a', secondary: '#1f1f2a', trim: '#3c8f4a' } }),
    blackbeard: crew('blackbeard', 'vortex',
      { primary: '#3a2a4a', secondary: '#c8a24a', trim: '#3a2a4a', alt: { primary: '#7a4b2a', secondary: '#c8a24a', trim: '#7a4b2a' } }),
    marine:     crew('marine', 'observation',
      { primary: '#2f6fd6', secondary: '#f4f4f4', trim: '#2f6fd6', alt: { primary: '#5fb0e8', secondary: '#f4f4f4', trim: '#5fb0e8' } })
  };
  const crewOrder = ['strawHat', 'whitebeard', 'redHair', 'heart', 'blackbeard', 'marine'];

  const fmt = (id, size, list) => ({ id, size, ships: list, nameKey: 'format.' + id + '.name', descKey: 'format.' + id + '.desc' });
  const formats = {
    escaramuca: fmt('escaramuca', 8, ['thousandSunny', 'redForce', 'polarTang', 'goingMerry']),
    classica:   fmt('classica', 10, ['mobyDick', 'thousandSunny', 'redForce', 'polarTang', 'goingMerry']),
    grandline:  fmt('grandline', 12, shipOrder.slice())
  };
  const formatOrder = ['escaramuca', 'classica', 'grandline'];

  const sea = (id, effect, tod) => ({ id, effect, tod, nameKey: 'sea.' + id + '.name', descKey: 'sea.' + id + '.desc' });
  const seas = {
    calmo:      sea('calmo', null, 'day'),
    grandline:  sea('grandline', 'jitter', 'dusk'),
    novomundo:  sea('novomundo', 'fog', 'night'),
    tempestade: sea('tempestade', 'gust', 'storm')
  };
  const seaOrder = ['calmo', 'grandline', 'novomundo', 'tempestade'];

  const diff = (id, style, bountyF) => ({ id, style, bountyF, nameKey: 'difficulty.' + id + '.name', descKey: 'difficulty.' + id + '.desc' });
  const difficulties = {
    grumete: diff('grumete', 'random', 0.5),
    marujo:  diff('marujo', 'random', 1),
    capitao: diff('capitao', 'edge', 2),
    yonkou:  diff('yonkou', 'spread', 4)
  };
  const difficultyOrder = ['grumete', 'marujo', 'capitao', 'yonkou'];

  const tech = (id, crewId, target, attack) => ({ id, crew: crewId, target, attack, nameKey: 'tech.' + id + '.name', descKey: 'tech.' + id + '.desc' });
  const techniques = {
    bazooka:     tech('bazooka', 'strawHat', 'cell2x2', true),
    tremor:      tech('tremor', 'whitebeard', 'cell', true),
    haki:        tech('haki', 'redHair', 'cell', false),
    room:        tech('room', 'heart', 'line', false),
    vortex:      tech('vortex', 'blackbeard', 'none', false),
    observation: tech('observation', 'marine', 'none', false)
  };

  const S = (id, r, c, dir) => ({ id, r, c, dir, len: ships[id].len });
  const sampleFleets = {
    escaramuca: { format: 'escaramuca', ships: [
      S('thousandSunny', 0, 1, 'h'), S('redForce', 2, 6, 'v'), S('polarTang', 5, 0, 'h'), S('goingMerry', 7, 4, 'h')] },
    classica: { format: 'classica', ships: [
      S('mobyDick', 1, 1, 'h'), S('thousandSunny', 3, 8, 'v'), S('redForce', 4, 2, 'v'), S('polarTang', 8, 4, 'h'), S('goingMerry', 6, 5, 'h')] },
    grandline: { format: 'grandline', ships: [
      S('mobyDick', 0, 0, 'h'), S('thousandSunny', 2, 7, 'h'), S('oroJackson', 4, 1, 'v'), S('redForce', 5, 5, 'v'),
      S('polarTang', 9, 8, 'h'), S('baratie', 11, 2, 'h'), S('goingMerry', 6, 10, 'v')] }
  };

  const flags = ['strawHat', 'whitebeard', 'redHair', 'heart', 'blackbeard', 'marine', 'roger', 'baratie'];

  GLT.data = {
    ships, shipOrder, crews, crewOrder, formats, formatOrder, seas, seaOrder,
    difficulties, difficultyOrder, techniques, flags,
    reactions: ['boaMira', 'prepareSe', 'gg', 'uau', 'porPouco', 'obrigado'],
    timers: [0, 20, 30, 60],
    seriesLengths: [1, 3, 5],
    tods: ['day', 'dusk', 'night', 'storm'],
    viewModes: ['both', 'own', 'aim', 'panorama', 'ceremony'],
    sampleFleets
  };
})();
