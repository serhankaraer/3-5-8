'use strict';
// Oynama kuralları: renge uy, rengin yoksa koz at, masadaki kartı büyütebiliyorsan büyüt.
const assert = require('assert');
const R = require('../packages/engine/rules');

const L = (hand, trick, trump) => R.legalCards(hand, trick.map((card, i) => ({ seat: i, card })), trump).slice().sort();
let eq0;
const eq = (a, b, msg) => assert.deepStrictEqual(a, b.slice().sort(), msg);

// açan oyuncu: her kart serbest
eq(L(['S5', 'H9'], [], 'D'), ['S5', 'H9'], 'ilk atan serbest');

// renge uymak zorunlu ve büyütebiliyorsan büyütmek zorunlu
eq(L(['S5', 'S12', 'S9', 'H14'], ['S8'], 'D'), ['S12', 'S9'], 'S8 büyütülmeli: S9 ve S12');
eq(L(['S5', 'S3', 'H14'], ['S8'], 'D'), ['S5', 'S3'], 'büyütemiyorsa renkteki herhangi kart');
eq(L(['S5', 'S12', 'H14'], ['S8', 'S10'], 'D'), ['S12'], 'masadaki en yüksek S10 büyütülmeli');

// rengi yok, kozu var: koz atmak zorunlu
eq(L(['H5', 'D3', 'D9', 'C14'], ['S8'], 'D'), ['D3', 'D9'], 'renk yok: yalnızca koz');
// masada koz varsa ve büyük kozu varsa büyütmek zorunlu
eq(L(['H5', 'D3', 'D9', 'D12'], ['S8', 'D6'], 'D'), ['D9', 'D12'], 'masadaki D6 kozu büyütülmeli');
eq(L(['H5', 'D3', 'D4'], ['S8', 'D6'], 'D'), ['D3', 'D4'], 'büyük kozu yoksa yine koz atmak zorunlu');
// hem rengi hem kozu yok: her kart serbest
eq(L(['H5', 'C3', 'C9'], ['S8'], 'D'), ['H5', 'C3', 'C9'], 'renk ve koz yok: serbest');

// masada koz var ama rengi var: rengi oynar, büyütme zorunluluğu yok (kozu geçemez)
eq(L(['S5', 'S12', 'D14'], ['S8', 'D6'], 'D'), ['S5', 'S12'], 'rengi varsa koza rağmen renk atar, büyütmek zorunlu değil');

// açılan renk kozsa
eq(L(['D5', 'D12', 'H14'], ['D8'], 'D'), ['D12'], 'açılan koz büyütülmeli');
eq(L(['H5', 'C12'], ['D8'], 'D'), ['H5', 'C12'], 'koz yoksa serbest');

// el (trick) kazananı: koz kesen kazanır
assert.strictEqual(R.trickWinner([{ seat: 0, card: 'S8' }, { seat: 1, card: 'D3' }, { seat: 2, card: 'S14' }], 'D'), 1);

// koz kırılmadan koz ile el açılmaz; yalnızca kozun ası, papazı, kızı ile açılır
const LEAD = (hand, trump, broken) => R.legalCards(hand, [], trump, broken).slice().sort();
eq0 = (a, b, msg) => assert.deepStrictEqual(a, b.slice().sort(), msg);
eq0(LEAD(['S5', 'D3', 'D12', 'D14', 'D9', 'D13', 'D11'], 'D', false), ['S5', 'D12', 'D13', 'D14'], 'kırılmadan: yan renk + koz A/K/Q');
eq0(LEAD(['S5', 'D3', 'D9'], 'D', false), ['S5'], 'kırılmadan: küçük koz açılamaz');
eq0(LEAD(['D3', 'D9'], 'D', false), ['D3', 'D9'], 'yalnızca koz kalmışsa her koz serbest');
eq0(LEAD(['S5', 'D3', 'D9'], 'D', true), ['S5', 'D3', 'D9'], 'koz kırıldıktan sonra serbest');
// kırılma durumu rengi uyma kurallarını etkilemez
eq0(R.legalCards(['H5', 'D3'], [{ seat: 0, card: 'S8' }], 'D', false).slice().sort(), ['D3'], 'rengi yoksa koz atmak zorunlu (kırılmamış olsa da)');

console.log('Oynama kuralı testleri OK');
