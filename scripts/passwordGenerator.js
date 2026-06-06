/**
 * passwordGenerator.js
 * ─────────────────────────────────────────────────────────────────────────────
 * Engine sinh mật khẩu ngẫu nhiên mạnh cho Chrome Extension.
 * - Dùng crypto.getRandomValues() — không dùng Math.random()
 * - Rejection sampling để tránh modulo bias
 * - Policy enforcement: đảm bảo có ít nhất 1 ký tự mỗi loại đã chọn
 * - Fisher-Yates shuffle sau enforcement
 * - Tính entropy và phân loại strength 6 cấp
 * - Passphrase mode (EFF wordlist)
 * ─────────────────────────────────────────────────────────────────────────────
 */

'use strict';

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. CHARSETS
 * ═══════════════════════════════════════════════════════════════════════════ */
const CHARSETS = {
  upper    : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ',
  lower    : 'abcdefghijklmnopqrstuvwxyz',
  digits   : '0123456789',
  symbols  : '!@#$%^&*()_+-=[]{}|;:,.<>?',
  ambiguous: '0O1lI', // ký tự dễ nhầm lẫn
};

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. DEFAULT OPTIONS
 * ═══════════════════════════════════════════════════════════════════════════ */

/** @typedef {{
 *   length      : number,
 *   useUpper    : boolean,
 *   useLower    : boolean,
 *   useDigits   : boolean,
 *   useSymbols  : boolean,
 *   noAmbiguous : boolean,
 *   customSymbols: string|null
 * }} GeneratorOptions */

const DEFAULT_OPTIONS = {
  length       : 16,
  useUpper     : true,
  useLower     : true,
  useDigits    : true,
  useSymbols   : true,
  noAmbiguous  : false,
  customSymbols: null,
};

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. CRYPTO HELPERS
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Trả về số nguyên ngẫu nhiên trong [0, max) — không có modulo bias.
 * Dùng rejection sampling: bỏ qua byte nằm ngoài vùng chia hết cho max.
 *
 * @param {number} max
 * @returns {number}
 */
function _randInt(max) {
  if (max <= 0) throw new RangeError('max phải > 0');
  const buf      = new Uint32Array(1);
  const ceiling  = (2 ** 32) - ((2 ** 32) % max); // bội số lớn nhất < 2^32
  let   val;
  do {
    crypto.getRandomValues(buf);
    val = buf[0];
  } while (val >= ceiling); // rejection: tránh bias
  return val % max;
}

/**
 * Chọn ngẫu nhiên 1 ký tự từ chuỗi charset.
 * @param {string} charset
 * @returns {string}
 */
function _randChar(charset) {
  return charset[_randInt(charset.length)];
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 4. CHARSET BUILDER
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Xây dựng pool ký tự từ options.
 * @param {GeneratorOptions} opts
 * @returns {{ pool: string, required: string[] }}
 */
function _buildPool(opts) {
  let pool = '';
  const required = []; // mỗi phần tử là 1 charset bắt buộc phải có 1 ký tự

  if (opts.useUpper) {
    pool += CHARSETS.upper;
    required.push(CHARSETS.upper);
  }
  if (opts.useLower) {
    pool += CHARSETS.lower;
    required.push(CHARSETS.lower);
  }
  if (opts.useDigits) {
    pool += CHARSETS.digits;
    required.push(CHARSETS.digits);
  }
  if (opts.useSymbols) {
    const sym = opts.customSymbols ?? CHARSETS.symbols;
    pool += sym;
    required.push(sym);
  }

  // Loại bỏ ký tự dễ nhầm
  if (opts.noAmbiguous) {
    for (const ch of CHARSETS.ambiguous) {
      pool = pool.split(ch).join('');
      // Cũng lọc khỏi required
      for (let i = 0; i < required.length; i++) {
        required[i] = required[i].split(ch).join('');
      }
    }
    // Bỏ charset rỗng sau lọc
    required.forEach((_, i) => {
      if (!required[i]) required.splice(i, 1);
    });
  }

  if (!pool.length) {
    throw new Error('Charset rỗng — hãy chọn ít nhất 1 loại ký tự.');
  }

  return { pool, required };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 5. POLICY ENFORCEMENT + SHUFFLE
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Đảm bảo password có ít nhất 1 ký tự từ mỗi charset bắt buộc.
 * Sau đó Fisher-Yates shuffle để không bị predictable.
 *
 * @param {string[]} chars    - mảng ký tự password
 * @param {string[]} required - mảng charset bắt buộc
 * @returns {string[]}
 */
function _enforceAndShuffle(chars, required) {
  const arr = [...chars];

  for (const charset of required) {
    if (!charset.length) continue;
    const hasOne = arr.some(c => charset.includes(c));
    if (!hasOne) {
      // Thay thế 1 ký tự tại vị trí ngẫu nhiên bằng ký tự đúng loại
      const pos = _randInt(arr.length);
      arr[pos] = _randChar(charset);
    }
  }

  // Fisher-Yates shuffle — ngăn ký tự "bắt buộc" tập trung ở đầu/cuối
  for (let i = arr.length - 1; i > 0; i--) {
    const j = _randInt(i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }

  return arr;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 6. MAIN GENERATOR
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Sinh mật khẩu ngẫu nhiên mạnh.
 *
 * @param {Partial<GeneratorOptions>} [options]
 * @returns {string}
 *
 * @example
 * generatePassword({ length: 20, useSymbols: false })
 * // "Kx9mBqN3rPdTy7vLhWcE"
 */
function generatePassword(options = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (opts.length < 4)  throw new RangeError('Độ dài tối thiểu là 4.');
  if (opts.length > 256) throw new RangeError('Độ dài tối đa là 256.');

  const { pool, required } = _buildPool(opts);

  // Buffer sinh ký tự — dùng rejection sampling trên từng byte
  // Precompute: max byte không bị bias
  const maxByte = 256 - (256 % pool.length);
  const bufSize  = Math.max(opts.length * 3, 64); // dư để tránh refill nhiều lần
  let   raw      = new Uint8Array(bufSize);
  let   ptr      = bufSize; // bắt đầu ở cuối → trigger refill ngay
  const chars    = [];

  crypto.getRandomValues(raw);
  ptr = 0;

  while (chars.length < opts.length) {
    if (ptr >= raw.length) {
      raw = new Uint8Array(bufSize);
      crypto.getRandomValues(raw);
      ptr = 0;
    }
    const byte = raw[ptr++];
    if (byte >= maxByte) continue; // rejection
    chars.push(pool[byte % pool.length]);
  }

  const final = _enforceAndShuffle(chars, required);
  return final.join('');
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 7. STRENGTH CHECKER
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * @typedef {{
 *   entropy   : number,
 *   score     : number,   // 0–5
 *   label     : string,
 *   color     : 'danger'|'warning'|'info'|'success',
 *   segments  : number,   // 1–5 thanh hiển thị
 *   crackTime : string,   // ước tính thời gian crack
 *   tips      : string[]  // gợi ý cải thiện
 * }} StrengthResult
 */

/** Ước tính thời gian crack dựa trên entropy và 10^10 guesses/s */
function _estimateCrackTime(entropy) {
  const guessesPerSec = 1e10; // GPU cluster
  const seconds       = (2 ** entropy) / guessesPerSec;

  if (seconds < 1)            return 'tức thì';
  if (seconds < 60)           return `${Math.round(seconds)} giây`;
  if (seconds < 3600)         return `${Math.round(seconds / 60)} phút`;
  if (seconds < 86400)        return `${Math.round(seconds / 3600)} giờ`;
  if (seconds < 2592000)      return `${Math.round(seconds / 86400)} ngày`;
  if (seconds < 31536000)     return `${Math.round(seconds / 2592000)} tháng`;
  if (seconds < 3.15e9)       return `${Math.round(seconds / 31536000)} năm`;
  if (seconds < 3.15e12)      return `${(seconds / 3.15e9).toFixed(1)} nghìn năm`;
  if (seconds < 3.15e15)      return `${(seconds / 3.15e12).toFixed(1)} triệu năm`;
  return 'cực kỳ lâu';
}

/**
 * Kiểm tra độ mạnh của mật khẩu.
 *
 * @param {string} password
 * @returns {StrengthResult}
 */
function checkStrength(password) {
  if (!password || !password.length) {
    return { entropy: 0, score: 0, label: 'Trống', color: 'danger', segments: 0, crackTime: 'tức thì', tips: [] };
  }

  // ── Tính pool size thực tế ──
  let poolSize = 0;
  if (/[a-z]/.test(password)) poolSize += 26;
  if (/[A-Z]/.test(password)) poolSize += 26;
  if (/\d/.test(password))    poolSize += 10;
  if (/[^a-zA-Z0-9]/.test(password)) poolSize += 32;

  const rawEntropy = password.length * Math.log2(Math.max(poolSize, 1));

  // ── Penalty factors ──
  const uniqueRatio   = new Set(password).size / password.length;
  const repeatPenalty = uniqueRatio < 0.5 ? 0.7 : (uniqueRatio < 0.7 ? 0.85 : 1.0);

  // Chuỗi bàn phím phổ biến
  const keyboardPatterns = ['qwerty', 'asdfgh', 'zxcvbn', '123456', 'abcdef', 'qazwsx'];
  const hasKeyboard = keyboardPatterns.some(p => password.toLowerCase().includes(p));
  const keyboardPenalty = hasKeyboard ? 0.75 : 1.0;

  // Lặp chuỗi (aaaa, abababab)
  const hasRepeatSeq = /(.+)\1{2,}/.test(password);
  const repeatSeqPenalty = hasRepeatSeq ? 0.7 : 1.0;

  const adjustedEntropy = rawEntropy * repeatPenalty * keyboardPenalty * repeatSeqPenalty;

  // ── Gợi ý cải thiện ──
  const tips = [];
  if (password.length < 12)          tips.push('Tăng độ dài lên ít nhất 12 ký tự');
  if (!/[A-Z]/.test(password))       tips.push('Thêm chữ hoa (A-Z)');
  if (!/[a-z]/.test(password))       tips.push('Thêm chữ thường (a-z)');
  if (!/\d/.test(password))          tips.push('Thêm số (0-9)');
  if (!/[^a-zA-Z0-9]/.test(password)) tips.push('Thêm ký tự đặc biệt (!@#...)');
  if (hasKeyboard)                   tips.push('Tránh chuỗi bàn phím (qwerty, 123456...)');
  if (uniqueRatio < 0.6)             tips.push('Giảm ký tự lặp lại');

  // ── Phân loại 6 cấp ──
  const levels = [
    { min: 0,   score: 0, label: 'Rất yếu',   color: 'danger',  segments: 1 },
    { min: 28,  score: 1, label: 'Yếu',        color: 'danger',  segments: 1 },
    { min: 40,  score: 2, label: 'Trung bình', color: 'warning', segments: 2 },
    { min: 60,  score: 3, label: 'Khá',        color: 'info',    segments: 3 },
    { min: 80,  score: 4, label: 'Mạnh',       color: 'success', segments: 4 },
    { min: 100, score: 5, label: 'Xuất sắc',   color: 'success', segments: 5 },
  ];

  const level = [...levels].reverse().find(l => adjustedEntropy >= l.min) || levels[0];

  return {
    entropy  : parseFloat(adjustedEntropy.toFixed(1)),
    rawEntropy: parseFloat(rawEntropy.toFixed(1)),
    score    : level.score,
    label    : level.label,
    color    : level.color,
    segments : level.segments,
    crackTime: _estimateCrackTime(adjustedEntropy),
    tips,
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 8. PASSPHRASE GENERATOR
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Danh sách từ EFF rút gọn (200 từ phổ biến, dễ nhớ, an toàn).
 * Production: thay bằng EFF large wordlist đầy đủ (7776 từ).
 */
const EFF_WORDLIST = [
  'apple','brave','cabin','dance','eagle','flame','grace','heart',
  'ivory','jewel','knife','lemon','maple','noble','ocean','pearl',
  'queen','river','storm','tiger','umbra','vapor','water','xenon',
  'yacht','zebra','amber','blend','crisp','delta','elder','frost',
  'globe','haste','inbox','joker','kiwi','lunar','magic','nerve',
  'olive','piano','quiet','radar','solar','table','ultra','vivid',
  'waltz','xerox','young','zonal','acute','birds','cream','debut',
  'email','falls','great','herbs','ideal','joint','karma','limit',
  'mango','night','opera','pixel','quota','robin','sugar','tower',
  'ultra','venus','world','xylem','yield','zesty','axiom','bloom',
  'coral','dunno','emote','fjord','guard','hippo','input','jumbo',
  'knack','lofty','metal','nexus','orbit','prose','quirk','recap',
  'salsa','tempo','under','viper','whirl','xeric','yearn','zippy',
  'agile','botch','craft','divan','epoch','finch','gruel','husky',
  'irony','jazzy','kudos','lapel','minor','notch','onion','plaid',
  'raven','skate','thorn','unify','venom','wrist','yodel','adorn',
  'bison','cloak','depot','envoy','fungi','glyph','honey','idiom',
  'joust','knelt','lodge','marsh','north','optic','plaza','query',
  'reign','snare','trout','urine','vigor','wheat','ultra','azure',
  'bulge','crypt','dwarf','evoke','flint','guava','hoard','index',
  'jumpy','knave','lance','mocha','nudge','otter','perch','quota',
];

/**
 * Sinh passphrase kiểu "Correct-Horse-Battery-Staple".
 *
 * @param {{
 *   wordCount  ?: number,   // mặc định 4
 *   separator  ?: string,   // mặc định '-'
 *   capitalize ?: boolean,  // mặc định true
 *   addNumber  ?: boolean,  // thêm số cuối: false
 *   addSymbol  ?: boolean,  // thêm ký tự đặc biệt: false
 * }} [options]
 * @returns {string}
 */
function generatePassphrase(options = {}) {
  const {
    wordCount  = 4,
    separator  = '-',
    capitalize = true,
    addNumber  = false,
    addSymbol  = false,
  } = options;

  if (wordCount < 3)  throw new RangeError('Cần ít nhất 3 từ.');
  if (wordCount > 10) throw new RangeError('Tối đa 10 từ.');

  const words = Array.from({ length: wordCount }, () => {
    const word = EFF_WORDLIST[_randInt(EFF_WORDLIST.length)];
    return capitalize ? word[0].toUpperCase() + word.slice(1) : word;
  });

  let phrase = words.join(separator);

  if (addNumber) {
    phrase += separator + _randInt(100).toString().padStart(2, '0');
  }
  if (addSymbol) {
    const syms = '!@#$%&*';
    phrase += _randChar(syms);
  }

  return phrase;
}

/**
 * Tính entropy cho passphrase.
 * @param {number} wordCount
 * @returns {number}
 */
function passphraseEntropy(wordCount) {
  return parseFloat((wordCount * Math.log2(EFF_WORDLIST.length)).toFixed(1));
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 9. UTILITY — copy to clipboard
 * ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Copy text vào clipboard. Dùng Clipboard API nếu có, fallback execCommand.
 * @param {string} text
 * @returns {Promise<boolean>}
 */
async function copyToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (_) {}

  // Fallback: execCommand (deprecated nhưng vẫn hoạt động trong extension)
  try {
    const el = document.createElement('textarea');
    el.value = text;
    el.style.position = 'fixed';
    el.style.opacity  = '0';
    document.body.appendChild(el);
    el.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(el);
    return ok;
  } catch (_) {
    return false;
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 10. EXPORT
 * ═══════════════════════════════════════════════════════════════════════════ */

// UMD export — hoạt động trong cả browser global và CommonJS
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = factory();
  } else {
    root.PasswordGenerator = factory();
  }
})(typeof globalThis !== 'undefined' ? globalThis : window, function () {
  return {
    generatePassword,
    generatePassphrase,
    checkStrength,
    passphraseEntropy,
    copyToClipboard,
    CHARSETS,
    DEFAULT_OPTIONS,
    version: '1.0.0',
  };
});