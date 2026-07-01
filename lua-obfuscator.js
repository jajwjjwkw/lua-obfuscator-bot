/**
 * 7CPXQ Lua Obfuscator - Prometheus-style
 * Features: String XOR Encryption, Number Morphing, Junk Injection,
 * Control Flow Flattening, Variable Renaming
 */
class LuaObfuscator {
  constructor(seed) {
    this.seed = seed || Math.floor(Math.random() * 99999);
    this.varMap = new Map();
    this.strEntries = [];
    this.strIndex = 0;
    this.varCounter = 0;
    this.xorKey = ((this.seed * 7 + 13) % 241) + 17;
    this.junkRate = 0.35;
  }

  obfuscate(source) {
    this.strEntries = [];
    this.varMap = new Map();
    this.varCounter = 0;
    this.strIndex = 0;

    let code = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    code = this.stripComments(code);
    code = this.encodeStrings(code);
    code = this.renameVars(code);
    code = this.morphNumbers(code);
    code = this.injectJunk(code);
    code = this.flattenCFG(code);
    code = this.buildHeader(code);
    code = this.crush(code);
    code = this.addObfuscationBanner(code);
    return code;
  }

  addObfuscationBanner(code) {
    const banner = [
      '--[[',
      '██████╗ ██████╗ ███████╗██╗   ██╗███████╗ ██████╗ █████╗ ████████╗███████╗██████╗',
      '██╔═══██╗██╔══██╗██╔════╝██║   ██║██╔════╝██╔════╝██╔══██╗╚══██╔══╝██╔════╝██╔══██╗',
      '██║   ██║██████╔╝█████╗  ██║   ██║███████╗██║     ███████║   ██║   █████╗  ██║  ██║',
      '██║   ██║██╔══██╗██╔══╝  ██║   ██║╚════██║██║     ██╔══██║   ██║   ██╔══╝  ██║  ██║',
      '╚██████╔╝██████╔╝███████╗╚██████╔╝███████║╚██████╗██║  ██║   ██║   ███████╗██████╔╝',
      ' ╚═════╝ ╚═════╝ ╚══════╝ ╚═════╝ ╚══════╝ ╚═════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═════╝',
      '',
      '    THIS SCRIPT WAS OBFUSCATED BY 7CPXQ [DEOBF & OBF TOOL]',
      '    USE INVITE THE BOT HERE FOR FREE:',
      '    DISCORD https://discord.gg/QwSF9JCYq',
      '',
      '    Date: ' + new Date().toISOString().split('T')[0],
      '    Seed: ' + this.seed,
      ']]',
      '',
    ].join('\n');
    return banner + code;
  }

  stripComments(code) {
    code = code.replace(/--\[\[[\s\S]*?\]\]/g, '');
    code = code.replace(/^#![^\n]*\n/, '');
    code = code.replace(/--(?!\[\[).*$/gm, '');
    return code;
  }

  encodeStrings(code) {
    code = code.replace(/"((?:[^"\\]|\\.)*)"/g, (m, c) => this.makeStrRef(c, '"'));
    code = code.replace(/'((?:[^'\\]|\\.)*)'/g, (m, c) => this.makeStrRef(c, "'"));
    return code;
  }

  makeStrRef(raw, quote) {
    let str = raw.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r')
      .replace(/\\\\/g, '\x00').replace(new RegExp('\\\\' + quote, 'g'), quote)
      .replace(/\x00/g, '\\');
    const id = this.strIndex++;
    const k = this.xorKey;
    const enc = [];
    for (let i = 0; i < str.length; i++) enc.push(str.charCodeAt(i) ^ (k + (i % 13)));
    this.strEntries.push({ id, enc: enc.join(',') });
    return '_S' + id.toString(36);
  }

  buildHeader(code) {
    if (this.strEntries.length === 0) return code;
    const k = this.xorKey;
    const te = this.strEntries.map(e => '[' + e.id + ']=(' + e.enc + ')').join(',');
    let hdr = 'local _ST={' + te + '};';
    hdr += 'local function _D(n)local t=_ST[n]local r={}';
    hdr += 'for i=1,#t do r[i]=string.char(t[i]~(' + k + '+(i-1)%13))end';
    hdr += 'return table.concat(r)end;';
    for (const e of this.strEntries) {
      code = code.replace(new RegExp('\\b' + '_S' + e.id.toString(36) + '\\b', 'g'), '_D(' + e.id + ')');
    }
    return hdr + code;
  }

  renameVars(code) {
    const reserved = new Set([
      'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for', 'function',
      'goto', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat', 'return', 'then',
      'true', 'until', 'while', 'game', 'workspace', 'script', 'pairs', 'ipairs',
      'math', 'string', 'table', 'print', 'warn', 'error', 'wait', 'spawn',
      'typeof', 'next', 'select', 'unpack', 'rawget', 'rawset', 'setmetatable',
    ]);

    const toRename = new Set();
    let m;

    // local function name()
    const r1 = /\blocal\s+function\s+([a-zA-Z_]\w*)\b/g;
    while ((m = r1.exec(code)) !== null) {
      if (!reserved.has(m[1]) && !m[1].startsWith('_S') && !m[1].startsWith('_D') && !m[1].startsWith('_ST'))
        toRename.add(m[1]);
    }

    // local var =
    const r2 = /\blocal\s+([a-zA-Z_]\w*)\s*[,=]/g;
    while ((m = r2.exec(code)) !== null) {
      if (!reserved.has(m[1]) && !m[1].startsWith('_'))
        toRename.add(m[1]);
    }

    // function name()
    const r3 = /\bfunction\s+([a-zA-Z_]\w*)\s*\(/g;
    while ((m = r3.exec(code)) !== null) {
      if (!reserved.has(m[1]) && !m[1].startsWith('_'))
        toRename.add(m[1]);
    }

    // function(params) params
    const r4 = /\bfunction\s*\(([^)]*)\)/g;
    while ((m = r4.exec(code)) !== null) {
      for (const p of m[1].split(',').map(s => s.trim()).filter(s => s && s !== '...'))
        if (!reserved.has(p) && !p.startsWith('_')) toRename.add(p);
    }

    // for var =
    const r5 = /\bfor\s+([a-zA-Z_]\w*)\s*[,=]/g;
    while ((m = r5.exec(code)) !== null) {
      if (!reserved.has(m[1]) && !m[1].startsWith('_'))
        toRename.add(m[1]);
    }

    const sorted = [...toRename].sort((a, b) => b.length - a.length);
    for (const n of sorted) {
      if (!this.varMap.has(n)) this.varMap.set(n, this.genVar());
    }
    for (const [orig, obf] of this.varMap) {
      code = code.replace(
        new RegExp('\\b' + orig.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g'),
        obf
      );
    }
    return code;
  }

  genVar() {
    const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_';
    const i = this.varCounter++;
    let result = '';
    let n = (i * 0x9E37 + this.seed) >>> 0;
    for (let j = 0; j < 8; j++) {
      result += chars[n % chars.length];
      n = Math.floor(n / chars.length);
    }
    return result;
  }

  morphNumbers(code) {
    return code.replace(/\b([3-9]|[1-9]\d+)\b/g, (m, num) => {
      const n = parseInt(num);
      const ops = [
        () => '(' + (n + 0xB) + '-0xB)',
        () => '((' + (n * 3) + ')//3)',
        () => 'math.floor(' + n + '.5)',
        () => '(' + (n + 0x2A) + '-0x2A)',
        () => '((' + (n << 1) + ')>>1)',
        () => '(' + n + '^1)',
      ];
      return ops[n % 6]();
    });
  }

  injectJunk(code) {
    const junk = [
      'local _=nil;_=nil',
      'do local __=#{}end',
      'local _=(function()return end)()',
      'local _,__=nil,nil',
      ';(function(...)end)()',
      'local _=0;_=0',
      'local _=#"";_=nil',
      'local R=select(1,unpack or table.unpack,{})',
    ];
    const lines = code.split('\n');
    const out = [];
    for (const line of lines) {
      out.push(line);
      if (line.trim() && !line.trim().startsWith('--') && Math.random() < this.junkRate) {
        out.push(junk[Math.floor(Math.random() * junk.length)]);
      }
    }
    return out.join('\n');
  }

  flattenCFG(code) {
    return code.replace(/\bfunction\s*\(([^)]*)\)([\s\S]*?)\bend\b/g, (full, params, body) => {
      const stmts = body.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('--'));
      if (stmts.length <= 5) return full;
      const groups = [];
      for (let i = 0; i < stmts.length; i += 3) groups.push(stmts.slice(i, i + 3).join(' '));
      if (groups.length < 2) return full;
      let flat = 'local _c=1;while _c>0 do ';
      for (let i = 0; i < groups.length; i++) {
        flat += (i === 0 ? 'if _c==' : 'elseif _c==') + (i + 1) + ' then ' + groups[i] + ' _c=' + (i + 1 < groups.length ? i + 2 : 0) + ' ';
      }
      flat += 'end end';
      return 'function(' + params + ')' + flat + 'end';
    });
  }

  crush(code) {
    return code
      .replace(/\n+/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .replace(/\s*([\(\)\[\]\{\},;])\s*/g, '$1')
      .replace(/\s*([+\-*/%^#]=?)\s*/g, '$1')
      .replace(/\s*\.\.\s*/g, '..')
      .replace(/\s*([<>]=?|==|~=)\s*/g, '$1')
      .replace(/;+/g, ';').trim();
  }
}

module.exports = LuaObfuscator;
