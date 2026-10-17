/**
 * safeTxVerify.js
 *
 * Independent, dependency-free verification of what a signer is about to
 * sign. Inlined into sign.html by buildPage.js and required by the Node tests
 * (test/base/SafeTxVerify.ts), so the browser and CI run the same code.
 *
 * WHY THE PAGE DOES THIS ITSELF
 *
 * The wallet signs `c.eip712`. Everything else the page used to show -- call
 * labels, token amounts, even `c.safeTxHash` -- is just more bundle text that
 * could disagree with that payload. So the page now derives everything it
 * displays FROM the payload it will hand to the wallet:
 *
 *   - domain separator, SafeTx struct hash and safeTxHash, recomputed here
 *     with a local keccak256 (these are what a Ledger shows when it cannot
 *     display the fields);
 *   - every SafeTx field, in the order a field-by-field device shows them;
 *   - `data` decoded word by word.
 *
 * and REFUSES to sign when the payload is not what the bundle claims:
 * hash mismatch, wrong chain or Safe, non-zero gas/refund fields, a
 * DELEGATECALL anywhere except a non-sweep MultiSendCallOnly batch, or (for
 * sweeps) anything other than one plain sweepAll CALL to this chain's router
 * whose recipient and token array match the manifest.
 *
 * No network access, no dependencies; BigInt is the only modern feature used.
 */
(function (root) {
  "use strict";

  /* ------------------------------ keccak256 ------------------------------ */

  var MASK = (1n << 64n) - 1n;
  var RC = [
    0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
    0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
    0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
    0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
    0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
    0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
  ];
  // Rotation offsets indexed by x + 5y.
  var ROT = [0, 1, 62, 28, 27, 36, 44, 6, 55, 20, 3, 10, 43, 25, 39, 41, 45, 15, 21, 8, 18, 2, 61, 56, 14];

  function rotl(v, n) {
    if (n === 0) return v;
    var b = BigInt(n);
    return ((v << b) | (v >> (64n - b))) & MASK;
  }

  function keccakF(A) {
    var C = new Array(5), D = new Array(5), B = new Array(25);
    for (var round = 0; round < 24; round++) {
      var x, y;
      for (x = 0; x < 5; x++) C[x] = A[x] ^ A[x + 5] ^ A[x + 10] ^ A[x + 15] ^ A[x + 20];
      for (x = 0; x < 5; x++) D[x] = C[(x + 4) % 5] ^ rotl(C[(x + 1) % 5], 1);
      for (var i = 0; i < 25; i++) A[i] ^= D[i % 5];
      for (x = 0; x < 5; x++) {
        for (y = 0; y < 5; y++) {
          B[y + 5 * ((2 * x + 3 * y) % 5)] = rotl(A[x + 5 * y], ROT[x + 5 * y]);
        }
      }
      for (y = 0; y < 5; y++) {
        for (x = 0; x < 5; x++) {
          A[x + 5 * y] = B[x + 5 * y] ^ (~B[((x + 1) % 5) + 5 * y] & MASK & B[((x + 2) % 5) + 5 * y]);
        }
      }
      A[0] ^= RC[round];
    }
  }

  /** keccak256 (the Ethereum variant: 0x01 padding, not SHA3's 0x06). */
  function keccak256(bytes) {
    var rate = 136;
    var A = new Array(25).fill(0n);
    var padded = new Uint8Array(Math.floor(bytes.length / rate) * rate + rate);
    padded.set(bytes);
    padded[bytes.length] ^= 0x01;
    padded[padded.length - 1] ^= 0x80;
    for (var off = 0; off < padded.length; off += rate) {
      for (var l = 0; l < rate / 8; l++) {
        var v = 0n;
        for (var k = 7; k >= 0; k--) v = (v << 8n) | BigInt(padded[off + l * 8 + k]);
        A[l] ^= v;
      }
      keccakF(A);
    }
    var out = new Uint8Array(32);
    for (var j = 0; j < 4; j++) {
      var lane = A[j];
      for (var b = 0; b < 8; b++) {
        out[j * 8 + b] = Number(lane & 0xffn);
        lane >>= 8n;
      }
    }
    return out;
  }

  /* ------------------------------ encoding ------------------------------- */

  function hexToBytes(hex) {
    var h = String(hex);
    if (!/^0x([0-9a-fA-F]{2})*$/.test(h)) throw new Error("not even-length 0x hex: " + h.slice(0, 20));
    h = h.slice(2);
    var out = new Uint8Array(h.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
    return out;
  }

  function bytesToHex(b) {
    var s = "0x";
    for (var i = 0; i < b.length; i++) s += (b[i] < 16 ? "0" : "") + b[i].toString(16);
    return s;
  }

  function utf8(s) {
    return new TextEncoder().encode(s);
  }

  function concat(parts) {
    var n = 0, i;
    for (i = 0; i < parts.length; i++) n += parts[i].length;
    var out = new Uint8Array(n), o = 0;
    for (i = 0; i < parts.length; i++) {
      out.set(parts[i], o);
      o += parts[i].length;
    }
    return out;
  }

  function toBig(v) {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") {
      if (!Number.isSafeInteger(v) || v < 0) throw new Error("bad integer " + v);
      return BigInt(v);
    }
    var s = String(v).trim();
    if (!/^(0x[0-9a-fA-F]+|[0-9]+)$/.test(s)) throw new Error("bad integer " + s);
    return BigInt(s);
  }

  function uint256(v) {
    var n = toBig(v);
    if (n < 0n || n >= 1n << 256n) throw new Error("uint256 out of range");
    var out = new Uint8Array(32);
    for (var i = 31; i >= 0; i--) {
      out[i] = Number(n & 0xffn);
      n >>= 8n;
    }
    return out;
  }

  function isAddress(a) {
    return /^0x[0-9a-fA-F]{40}$/.test(String(a));
  }

  function addressWord(a) {
    if (!isAddress(a)) throw new Error("bad address " + a);
    var out = new Uint8Array(32);
    out.set(hexToBytes(a), 12);
    return out;
  }

  /** EIP-55 checksum, so displayed addresses match what wallets show. */
  function checksum(a) {
    if (!isAddress(a)) return String(a);
    var lower = String(a).slice(2).toLowerCase();
    var h = bytesToHex(keccak256(utf8(lower))).slice(2);
    var out = "0x";
    for (var i = 0; i < 40; i++) out += parseInt(h[i], 16) >= 8 ? lower[i].toUpperCase() : lower[i];
    return out;
  }

  function eqAddr(a, b) {
    return String(a).toLowerCase() === String(b).toLowerCase();
  }

  /* ------------------------------ SafeTx -------------------------------- */

  var ZERO = "0x0000000000000000000000000000000000000000";
  var MULTISEND_CALL_ONLY = "0x9641d764fc13c8B624c04430C7356C1C7C8102e2";
  var SWEEP_ALL_SELECTOR = "0xccb60e25";

  var SAFE_TX_FIELDS = [
    ["to", "address"], ["value", "uint256"], ["data", "bytes"], ["operation", "uint8"],
    ["safeTxGas", "uint256"], ["baseGas", "uint256"], ["gasPrice", "uint256"],
    ["gasToken", "address"], ["refundReceiver", "address"], ["nonce", "uint256"],
  ];
  var DOMAIN_FIELDS = [["chainId", "uint256"], ["verifyingContract", "address"]];

  function typeString(name, fields) {
    return name + "(" + fields.map(function (f) { return f[1] + " " + f[0]; }).join(",") + ")";
  }
  var SAFE_TX_TYPEHASH = keccak256(utf8(typeString("SafeTx", SAFE_TX_FIELDS)));
  var DOMAIN_TYPEHASH = keccak256(utf8(typeString("EIP712Domain", DOMAIN_FIELDS)));

  function sameFields(actual, expected) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    for (var i = 0; i < expected.length; i++) {
      if (!actual[i] || actual[i].name !== expected[i][0] || actual[i].type !== expected[i][1]) return false;
    }
    return true;
  }

  /**
   * Hash an EIP-712 SafeTx payload exactly as the wallet will. Throws if the
   * payload's types are not the canonical Safe v1.3+ ones: a payload with a
   * different type list would make the wallet show something else.
   */
  function hashSafeTxPayload(p) {
    if (!p || p.primaryType !== "SafeTx") throw new Error("primaryType is not SafeTx");
    var types = p.types || {};
    var extra = Object.keys(types).filter(function (k) { return k !== "SafeTx" && k !== "EIP712Domain"; });
    if (extra.length) throw new Error("unexpected EIP-712 types: " + extra.join(","));
    if (!sameFields(types.SafeTx, SAFE_TX_FIELDS)) throw new Error("SafeTx type list is not the canonical Safe one");
    if (!sameFields(types.EIP712Domain, DOMAIN_FIELDS)) {
      throw new Error("EIP712Domain must be exactly (uint256 chainId, address verifyingContract)");
    }
    var d = p.domain || {};
    var extraDomain = Object.keys(d).filter(function (k) { return k !== "chainId" && k !== "verifyingContract"; });
    if (extraDomain.length) throw new Error("unexpected domain fields: " + extraDomain.join(","));
    var m = p.message || {};
    var dataBytes = hexToBytes(m.data);
    var dataHash = keccak256(dataBytes);
    var domainSeparator = keccak256(concat([DOMAIN_TYPEHASH, uint256(d.chainId), addressWord(d.verifyingContract)]));
    var op = toBig(m.operation);
    if (op > 255n) throw new Error("operation out of range");
    var structHash = keccak256(concat([
      SAFE_TX_TYPEHASH, addressWord(m.to), uint256(m.value), dataHash, uint256(op),
      uint256(m.safeTxGas), uint256(m.baseGas), uint256(m.gasPrice),
      addressWord(m.gasToken), addressWord(m.refundReceiver), uint256(m.nonce),
    ]));
    var safeTxHash = keccak256(concat([new Uint8Array([0x19, 0x01]), domainSeparator, structHash]));
    return {
      domainSeparator: bytesToHex(domainSeparator),
      messageHash: bytesToHex(structHash),
      dataHash: bytesToHex(dataHash),
      safeTxHash: bytesToHex(safeTxHash),
      dataLength: dataBytes.length,
    };
  }

  /* ------------------------------ calldata ------------------------------ */

  function words(dataHex) {
    var b = hexToBytes(dataHex);
    var out = [];
    for (var o = 4; o < b.length; o += 32) out.push(bytesToHex(b.slice(o, o + 32)));
    return out;
  }

  /**
   * Strictly decode sweepAll(address[],bool,address). Any deviation from the
   * canonical encoding (offsets, padding, trailing bytes) is an error: two
   * encodings of "the same" call would hash differently, and a lenient decoder
   * is how a page ends up describing bytes it did not actually check.
   */
  function decodeSweepAll(dataHex) {
    var b = hexToBytes(dataHex);
    if (b.length < 4 || bytesToHex(b.slice(0, 4)) !== SWEEP_ALL_SELECTOR) {
      throw new Error("selector is not sweepAll (" + SWEEP_ALL_SELECTOR + ")");
    }
    var w = words(dataHex);
    if ((b.length - 4) % 32 !== 0) throw new Error("calldata is not whole 32-byte words");
    if (w.length < 4) throw new Error("calldata too short for sweepAll");
    if (toBig(w[0]) !== 96n) throw new Error("tokens offset is not 0x60");
    var flag = toBig(w[1]);
    if (flag !== 0n && flag !== 1n) throw new Error("includeEth is not a clean bool");
    if (!/^0x0{24}/.test(w[2])) throw new Error("recipient word has dirty high bytes");
    var n = Number(toBig(w[3]));
    if (w.length !== 4 + n) throw new Error("token count " + n + " does not match calldata length");
    var tokens = [];
    for (var i = 0; i < n; i++) {
      if (!/^0x0{24}/.test(w[4 + i])) throw new Error("token[" + i + "] has dirty high bytes");
      tokens.push(checksum("0x" + w[4 + i].slice(26)));
    }
    return {
      selector: SWEEP_ALL_SELECTOR,
      includeEth: flag === 1n,
      to: checksum("0x" + w[2].slice(26)),
      tokens: tokens,
      words: w,
    };
  }

  /* ------------------------------ verification -------------------------- */

  /**
   * Verify one bundle chain. Returns { ok, errors[], warnings[], view } where
   * `view` is everything the page displays -- all of it derived from the
   * EIP-712 payload, none of it from labels.
   */
  function verifyChain(bundle, c) {
    var errors = [];
    var warnings = [];
    var view = { fields: [], hashes: null, decoded: null };
    function need(cond, msg) { if (!cond) errors.push(msg); }

    var p = c && c.eip712;
    var h;
    try {
      h = hashSafeTxPayload(p);
    } catch (e) {
      errors.push("payload: " + (e && e.message ? e.message : e));
      return { ok: false, errors: errors, warnings: warnings, view: view };
    }
    view.hashes = h;
    var d = p.domain, m = p.message;

    // Domain: exactly this chain and this Safe.
    need(toBig(d.chainId) === BigInt(c.chainId), "domain chainId " + toBig(d.chainId) + " is not " + c.chainId);
    need(eqAddr(d.verifyingContract, bundle.safe), "domain verifyingContract is not the bundle Safe");
    need(String(h.safeTxHash).toLowerCase() === String(c.safeTxHash).toLowerCase(),
      "recomputed safeTxHash " + h.safeTxHash + " != bundle " + c.safeTxHash);

    // The payload the wallet signs must equal the bundle's own tx record.
    if (c.tx) {
      SAFE_TX_FIELDS.forEach(function (f) {
        var k = f[0], a = m[k], b = c.tx[k];
        var same = f[1] === "address" ? eqAddr(a, b)
          : f[1] === "bytes" ? String(a).toLowerCase() === String(b).toLowerCase()
          : toBig(a) === toBig(b);
        need(same, "payload " + k + " differs from bundle tx." + k);
      });
    }
    need(String(c.nonce) === String(toBig(m.nonce)), "payload nonce differs from bundle nonce");

    // Fields that could pay someone or alter execution: must be zero.
    ["safeTxGas", "baseGas", "gasPrice"].forEach(function (k) {
      need(toBig(m[k]) === 0n, k + " must be 0 (is " + m[k] + ")");
    });
    need(eqAddr(m.gasToken, ZERO), "gasToken must be the zero address");
    need(eqAddr(m.refundReceiver, ZERO), "refundReceiver must be the zero address");

    var op = Number(toBig(m.operation));
    var calls = c.calls || [];
    var isMultiSend = op === 1 && eqAddr(m.to, MULTISEND_CALL_ONLY);
    if (op === 1) {
      need(isMultiSend, "DELEGATECALL to " + m.to + " (only MultiSendCallOnly is ever acceptable)");
      if (isMultiSend) warnings.push("DELEGATECALL to MultiSendCallOnly: batched admin calls, inner calls are plain CALLs");
    } else {
      need(op === 0, "operation " + op + " is neither CALL(0) nor DELEGATECALL(1)");
      if (calls.length === 1) {
        need(eqAddr(m.to, calls[0].to), "payload to differs from the bundle's call target");
        need(String(m.data).toLowerCase() === String(calls[0].data).toLowerCase(),
          "payload data differs from the bundle's call data");
        need(toBig(m.value) === toBig(calls[0].value || 0), "payload value differs from the bundle's call value");
      } else {
        errors.push("a direct CALL must carry exactly one bundle call (has " + calls.length + ")");
      }
    }

    if (bundle.intent === "sweep") {
      need(op === 0, "a sweep must be a plain CALL (operation 0)");
      need(eqAddr(m.to, c.router), "a sweep must call this chain's router " + c.router);
      need(toBig(m.value) === 0n, "a sweep must send value 0");
      try {
        var dec = decodeSweepAll(m.data);
        view.decoded = dec;
        if (c.sweep) {
          need(eqAddr(dec.to, c.sweep.recipient), "calldata recipient " + dec.to + " != manifest recipient");
          need(dec.includeEth === !!c.sweep.includeEth, "calldata includeEth differs from manifest");
          if (Array.isArray(c.sweep.tokens)) {
            var same = c.sweep.tokens.length === dec.tokens.length && c.sweep.tokens.every(function (t, i) {
              return eqAddr(t.token, dec.tokens[i]);
            });
            need(same, "calldata token array differs from the manifest token list");
          }
        } else {
          errors.push("sweep chain carries no manifest");
        }
        if (bundle.params && bundle.params.recipient) {
          need(eqAddr(dec.to, bundle.params.recipient), "calldata recipient differs from the bundle recipient");
        }
      } catch (e) {
        errors.push("calldata: " + (e && e.message ? e.message : e));
      }
    }

    view.fields = [
      { group: "domain", name: "chainId", value: String(toBig(d.chainId)) + "  (0x" + toBig(d.chainId).toString(16) + ")" },
      { group: "domain", name: "verifyingContract", value: checksum(d.verifyingContract), note: "the Safe" },
      { group: "message", name: "to", value: checksum(m.to),
        note: eqAddr(m.to, c.router) ? "OkuRouter on " + c.network : isMultiSend ? "MultiSendCallOnly" : "" },
      { group: "message", name: "value", value: String(toBig(m.value)) },
      { group: "message", name: "data", value: h.dataLength + " bytes, keccak " + h.dataHash },
      { group: "message", name: "operation", value: String(op) + (op === 0 ? "  (CALL)" : "  (DELEGATECALL)") },
      { group: "message", name: "safeTxGas", value: String(toBig(m.safeTxGas)) },
      { group: "message", name: "baseGas", value: String(toBig(m.baseGas)) },
      { group: "message", name: "gasPrice", value: String(toBig(m.gasPrice)) },
      { group: "message", name: "gasToken", value: checksum(m.gasToken) },
      { group: "message", name: "refundReceiver", value: checksum(m.refundReceiver) },
      { group: "message", name: "nonce", value: String(toBig(m.nonce)) },
    ];
    view.data = String(m.data);
    view.words = words(m.data);

    return { ok: errors.length === 0, errors: errors, warnings: warnings, view: view };
  }

  var api = {
    keccak256: keccak256,
    hexToBytes: hexToBytes,
    bytesToHex: bytesToHex,
    checksum: checksum,
    hashSafeTxPayload: hashSafeTxPayload,
    decodeSweepAll: decodeSweepAll,
    verifyChain: verifyChain,
    constants: { MULTISEND_CALL_ONLY: MULTISEND_CALL_ONLY, SWEEP_ALL_SELECTOR: SWEEP_ALL_SELECTOR },
  };
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.SafeTxVerify = api;
})(this);
