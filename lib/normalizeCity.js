'use strict';

const ALIASES = {
  // Karachi
  khi:       'karachi',
  karachi:   'karachi',
  krachi:    'karachi',
  karchi:    'karachi',

  // Lahore
  lhr:    'lahore',
  lahore: 'lahore',
  lahor:  'lahore',

  // Islamabad
  isb:        'islamabad',
  islamabad:  'islamabad',
  islmabad:   'islamabad',
  islambad:   'islamabad',

  // Rawalpindi
  rwp:        'rawalpindi',
  rawalpindi: 'rawalpindi',
  pindi:      'rawalpindi',

  // Faisalabad
  fsd:        'faisalabad',
  faisalabad: 'faisalabad',
  lyallpur:   'faisalabad',

  // Multan
  multan: 'multan',
  mux:    'multan',

  // Peshawar
  peshawar: 'peshawar',
  pesh:     'peshawar',
  pew:      'peshawar',

  // Quetta
  quetta: 'quetta',
  uet:    'quetta',

  // Sialkot
  sialkot: 'sialkot',
  skt:     'sialkot',

  // Gujranwala
  gujranwala: 'gujranwala',
  gwl:        'gujranwala',

  // Hyderabad
  hyderabad: 'hyderabad',
  hyd:       'hyderabad',

  // Sukkur
  sukkur: 'sukkur',
  skr:    'sukkur',

  // Bahawalpur
  bahawalpur: 'bahawalpur',
  bwp:        'bahawalpur',

  // Sargodha
  sargodha: 'sargodha',
  sgd:      'sargodha',

  // Others
  mardan:       'mardan',
  abbottabad:   'abbottabad',
  atd:          'abbottabad',
  mirpur:       'mirpur',
  gilgit:       'gilgit',
  muzaffarabad: 'muzaffarabad',
};

function normalizeCity(raw) {
  if (raw == null || raw === '') return 'unknown';
  const trimmed  = String(raw).trim().replace(/\s+/g, ' ');
  if (trimmed === '') return 'unknown';
  const lower    = trimmed.toLowerCase();
  return ALIASES[lower] || lower;
}

module.exports = { normalizeCity };
