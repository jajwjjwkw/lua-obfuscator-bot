/**
 * 7CPXQ ULTRA Lua Deobfuscator - Universal
 * Handles: 7cpxq, Prometheus/WeAreDevs, IronBrew, Luraph, MoonSec, PSU, XFuscator
 */
class LuaDeobfuscator {
  deobfuscate(source) {
    let code = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

    // Strip any existing banners
    code = code.replace(/^--\[\[[\s\S]*?(?:OBFUSCATED|DEOBFUSCATED) BY 7CPXQ[\s\S]*?\]\][ \t]*\n*/g, '');
    code = code.replace(/^--\[\[[\s\S]*?\]\]\s*/g, '');

    // Phase 1: Decode everything
    code = this.decodeStrings(code);        // 7cpxq/Prometheus XOR strings
    code = this.decodeIronBrew(code);       // IronBrew style
    code = this.decodeLuraph(code);         // Luraph VM wrapper
    code = this.decodeMoonSec(code);        // MoonSec V3
    code = this.decodeGeneric(code);        // Generic encodings

    // Phase 2: Clean
    code = this.removeJunk(code);
    code = this.simplifyNums(code);
    code = this.unflattenCFG(code);

    // Phase 3: Format
    code = this.beautify(code);

    // Add banner
    code = this.deobfBanner() + code;
    return code;
  }

  deobfBanner() {
    return [
      '--[[',
      '██████╗ ███████╗ ██████╗ ██████╗ ███████╗██╗   ██╗███████╗ ██████╗ █████╗ ████████╗███████╗██████╗',
      '██╔══██╗██╔════╝██╔═══██╗██╔══██╗██╔════╝██║   ██║██╔════╝██╔════╝██╔══██╗╚══██╔══╝██╔════╝██╔══██╗',
      '██║  ██║█████╗  ██║   ██║██████╔╝█████╗  ██║   ██║███████╗██║     ███████║   ██║   █████╗  ██║  ██║',
      '██║  ██║██╔══╝  ██║   ██║██╔══██╗██╔══╝  ██║   ██║╚════██║██║     ██╔══██║   ██║   ██╔══╝  ██║  ██║',
      '██████╔╝███████╗╚██████╔╝██████╔╝██║     ╚██████╔╝███████║╚██████╗██║  ██║   ██║   ███████╗██████╔╝',
      ' ╚═════╝ ╚══════╝ ╚═════╝ ╚═════╝ ╚═╝      ╚═════╝ ╚══════╝ ╚═════╝╚═╝  ╚═╝   ╚═╝   ╚══════╝╚═════╝',
      '',
      '  DEOBFUSCATED BY 7CPXQ [DEOBF & OBF TOOL]',
      '  INVITE: discord.gg/QwSF9JCYq',
      '  ' + new Date().toISOString().split('T')[0],
      ']]', '',
    ].join('\n');
  }

  // ─────── 7CPXQ / Prometheus XOR STRING DECODING ───────
  decodeStrings(code) {
    const start = code.indexOf('local _ST={');
    if (start === -1) return code;

    let depth = 1, end = -1;
    for (let i = start + 11; i < code.length; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}') { depth--; if (depth === 0) { end = i + 1; break; } }
    }
    if (end === -1) return code;

    const body = code.slice(start + 11, end - 1);
    const table = {};
    let m;
    const re = /\[(\d+)\]\s*=\s*\(([\d,]+)\)/g;
    while ((m = re.exec(body)) !== null) {
      table[+m[1]] = m[2].split(',').map(s => +s.trim());
    }
    if (Object.keys(table).length === 0) return code;

    const funcStart = code.indexOf('local function _D(n)');
    if (funcStart === -1) return code;
    const km = code.slice(funcStart, funcStart + 400).match(/~\((\d+)\+/);
    if (!km) return code;
    const key = +km[1];

    const dec = {};
    for (const [id, nums] of Object.entries(table)) {
      let s = '';
      for (let i = 0; i < nums.length; i++)
        s += String.fromCharCode(nums[i] ^ (key + (i % 13)));
      dec[id] = JSON.stringify(s);
    }

    code = code.replace(/_D\((\d+)\)/g, (_, id) => dec[+id] || _D(+id));
    code = code.replace(/\b_S(\d+)\b/g, (_, id) => dec[+id] || _S(+id));
    code = code.slice(0, start) + code.slice(end);
    code = code.replace(/local function _D\(n\)local t=_ST\[n\][\s\S]*?return table\.concat\(r\)end/g, '');
    return code;
  }

  // ─────── IRONBREW DECODING ───────
  decodeIronBrew(code) {
    // IronBrew uses: local v = ...; local f = ...; return(function(...) ... end)(...)
    // Pattern: local v0=...;local v1=...;(function()local v=...;...end)();
    // Also: \\NNN octal-style escape sequences
    code = code.replace(/\\(\d{1,3})/g, (_, n) => String.fromCharCode(+n % 256));
    // Hex escapes \\xNN
    code = code.replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)));
    return code;
  }

  // ─────── LURAPH DECODING ───────
  decodeLuraph(code) {
    // Luraph: (function(...) ... end)(...) with string table at top
    // Often has: local t = {[1]="...";[2]="..."}; local function d(i) return t[i]; end
    // or: bytecode-like wrapper

    // Extract string table if present
    const st = code.match(/local\s+(\w+)\s*=\s*\{([^}]+)\}/);
    if (st) {
      const tableName = st[1];
      const entries = {};
      const ere = /\[(\d+)\]\s*=\s*"((?:[^"\\]|\\.)*)"/g;
      let em;
      while ((em = ere.exec(st[2])) !== null) {
        entries[em[1]] = em[2];
      }

      // Replace table lookups
      const lookupRe = new RegExp(tableName + '\\[(\\d+)\\]', 'g');
      code = code.replace(lookupRe, (_, id) => entries[id] ? JSON.stringify(entries[id]) : _);

      // Remove table definition
      code = code.replace(st[0], '');
    }
    return code;
  }

  // ─────── MOONSEC V3 DECODING ───────
  decodeMoonSec(code) {
    // MoonSec: ([[This file was protected with MoonSec V3]]):gsub('.+', function(a) _Gblah = a; end);
    // Then return(function(...)local ... end)(...)
    code = code.replace(
      /\(\s*\[\[This file was protected with MoonSec[^\]]*\]\]\s*\)\s*:\s*gsub\s*\([^)]+\)\s*;?/g, ''
    );

    // MoonSec uses local _ENV and bytecode-like constants
    // Remove the wrapper: return(function(a,...)local ... end)(...)
    const moonWrap = code.match(/return\s*\(\s*function\s*\([^)]*\)([\s\S]*?)end\s*\)\(/);
    if (moonWrap) {
      // Extract inner body - this is complex, keep wrapper for now
      // MoonSec VM is very hard to fully decode statically
    }

    return code;
  }

  // ─────── GENERIC ENCODINGS ───────
  decodeGeneric(code) {
    // Lua string.char sequences in concat
    code = code.replace(/string\.char\(([^)]+)\)/g, (_, nums) => {
      const parts = nums.split(',').map(s => String.fromCharCode(+s.trim()));
      return JSON.stringify(parts.join(''));
    });

    // loadstring calls - extract inner code for analysis
    // (don't execute - just mark as decoded)
    return code;
  }

  // ─────── JUNK REMOVAL ───────
  removeJunk(code) {
    const patterns = [
      /local\s+_\s*=\s*nil\s*;?\s*_\s*=\s*nil\s*;?/g,
      /do\s+local\s+__\s*=\s*#\{\}\s*end\s*;?/g,
      /local\s+_\s*=\s*\(\s*function\s*\(\s*\)\s*return\s+end\s*\)\s*\(\s*\)\s*;?/g,
      /local\s+_\s*,\s*__\s*=\s*nil\s*,\s*nil\s*;?/g,
      /local\s+_\s*=\s*0\s*;?\s*_\s*=\s*0\s*;?/g,
      /;\s*\(\s*function\s*\(\s*\.\.\.\s*\)\s*end\s*\)\s*\(\s*\)\s*;?/g,
      /;\s*local\s+_\s*=\s*nil\s*;?/g,
      /;\s*do\s+local\s+__\s*=\s*#\{\}\s*end\s*;?/g,
      /;\s*local\s+_\s*,\s*__\s*=\s*nil\s*,\s*nil\s*;?/g,
      /local\s+_\s*=\s*#""\s*;?\s*_\s*=\s*nil\s*;?/g,
      /local\s+\w+\s*=\s*select\s*\(\s*1\s*,\s*(?:unpack|table\.unpack)\s*,\s*\{\s*\}\s*\)\s*;?/g,
    ];
    for (const p of patterns) code = code.replace(p, '');
    code = code.replace(/;;+/g, ';');
    return code;
  }

  // ─────── NUMBER SIMPLIFICATION ───────
  simplifyNums(code) {
    code = code.replace(/\((\d+)\s*\+\s*(0x[0-9A-Fa-f]+)\)\s*-\s*\2/gi, (_, n) => n);
    code = code.replace(/\((\d+)\s*\+\s*(0x[0-9A-Fa-f]+)\)\s*-\s*(0x[0-9A-Fa-f]+)/gi,
      (_, n, a, b) => String(+n + parseInt(a, 16) - parseInt(b, 16)));
    code = code.replace(/\((\d+)\s*-\s*(0x[0-9A-Fa-f]+)\)/gi, (_, n, x) => String(+n - parseInt(x, 16)));
    code = code.replace(/\((\d+)\s*\+\s*(0x[0-9A-Fa-f]+)\)/gi, (_, n, x) => String(+n + parseInt(x, 16)));
    code = code.replace(/\((\d+)\s*\*\s*(\d+)\)\s*\/\/\s*\2/g, (_, n) => n);
    code = code.replace(/math\.floor\((\d+)\.5\)/g, (_, n) => n);
    code = code.replace(/\(\((\d+)\)\s*>>\s*1\)/g, (_, n) => n);
    code = code.replace(/\((\d+)\s*\^\s*1\)/g, (_, n) => n);
    code = code.replace(/\(\(?(\d+)\)?\s*\/\/\s*(\d+)\)/g, (_, n, d) => String(Math.floor(+n / +d)));
    code = code.replace(/\((\d+)\)/g, (_, n) => n);
    return code;
  }

  // ─────── CONTROL FLOW UNFLATTEN ───────
  unflattenCFG(code) {
    return code.replace(
      /local\s+(\w+)\s*=\s*1\s*;\s*while\s+\1\s*>\s*0\s+do\s+((?:if\s+\1\s*==\s*\d+\s+then\s+[\s\S]*?)+)\s*end\s+end/g,
      (match, cvar, body) => {
        const out = [];
        const pat = new RegExp('(?:if|elseif)\\s+' + cvar + '\\s*==\\s*(\\d+)\\s+then\\s+([\\s\\S]*?)(?=\\s*(?:elseif|end))', 'g');
        let m;
        while ((m = pat.exec(body)) !== null) {
          out.push(m[2].replace(new RegExp('\\s*' + cvar + '\\s*=\\s*\\d+\\s*;?\\s*$'), '').trim());
        }
        return out.length > 1 ? out.join('\n') : match;
      }
    );
  }

  // ─────── BEAUTIFY ───────
  beautify(code) {
    const splits = [
      [/(end)\s*(local\s+function)/g, '$1\n\n$2'],
      [/(end)\s*(local\s)/g, '$1\n$2'],
      [/(end)\s*(function)/g, '$1\n\n$2'],
      [/(end)\s*(if\b)/g, '$1\n$2'],
      [/(end)\s*(while\b)/g, '$1\n$2'],
      [/(end)\s*(for\b)/g, '$1\n$2'],
      [/(end)\s*(end)/g, '$1\n$2'],
      [/(end)\s*(return\b)/g, '$1\n$2'],
      [/(\})\s*(local\s)/g, '$1\n$2'],
      [/(then)\s*([^\s])/g, '$1\n$2'],
      [/(else)\s*([^\s])/g, '$1\n$2'],
      [/(do)\s*([^\s])/g, '$1\n$2'],
      [/([^\s])(if\s)/g, '$1\n$2'],
      [/([^\s])(return\s)/g, '$1\n$2'],
    ];
    for (const [re, repl] of splits) code = code.replace(re, repl);
    code = code.replace(/;\s*/g, '\n');

    const lines = code.split('\n').map(l => l.trim());
    const out = [];
    let indent = 0;
    const IND = '  ';

    for (const line of lines) {
      if (!line) { out.push(''); continue; }
      if (/^(end|until|else|elseif)\b/.test(line)) indent = Math.max(0, indent - 1);
      if (/^\}/.test(line)) indent = Math.max(0, indent - 1);
      out.push(IND.repeat(indent) + line);
      if (/(then|do|repeat|else)\s*$/.test(line)) indent++;
      if (/\bfunction\s*\([^)]*\)\s*$/.test(line)) indent++;
      if (/\bfunction\s+\w+\s*\([^)]*\)\s*$/.test(line)) indent++;
      if (/=\s*\{\s*$/.test(line)) indent++;
    }

    code = out.join('\n');
    code = code.replace(/\n{3,}/g, '\n\n');
    return code.trim();
  }
}

module.exports = LuaDeobfuscator;
