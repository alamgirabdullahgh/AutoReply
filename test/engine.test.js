'use strict';
const test = require('node:test');
const assert = require('node:assert');
const E = require('../engine');

const R = (o) => E.newRule(o);

test('ডিফল্ট সালাম নিয়ম: হুবহু (চিহ্ন/হাতের অক্ষর বাদ)', () => {
  const rules = E.defaultRules();
  assert.strictEqual(E.match(rules, 'আসসালামু আলাইকুম', false), 'ওয়া আলাইকুম আসসালাম');
  assert.strictEqual(E.match(rules, 'Assalamu Alaikum!', false), 'ওয়া আলাইকুম আসসালাম');
  assert.strictEqual(E.match(rules, 'assalamualaikum 😊', false), 'ওয়া আলাইকুম আসসালাম');
  assert.strictEqual(E.match(rules, 'আসসালামু আলাইকুম, দাম কত?', false), null);
});

test('ডিফল্ট হাই/হ্যালো', () => {
  const rules = E.defaultRules();
  assert.strictEqual(E.match(rules, 'Hello', false), 'আসসালামু আলাইকুম');
  assert.strictEqual(E.match(rules, 'hi.', false), 'আসসালামু আলাইকুম');
  assert.strictEqual(E.match(rules, 'hi there', false), null);
});

test('Contains: ছোট ইংরেজি শব্দ শুধু পুরো শব্দ হিসেবে মেলে', () => {
  const r = [R({ keys: 'hi', reply: 'x' })];
  assert.strictEqual(E.match(r, 'oh hi there', false), 'x');
  assert.strictEqual(E.match(r, 'this is it', false), null);
});

test('Contains: বাংলা শব্দ অংশ হিসেবেও মেলে, কমা/নতুন লাইনে আলাদা', () => {
  const r = [R({ keys: 'দাম, মূল্য\nprice list', reply: 'p' })];
  assert.strictEqual(E.match(r, 'ওষুধের দাম কত?', false), 'p');
  assert.strictEqual(E.match(r, 'send me the Price List please', false), 'p');
  assert.strictEqual(E.match(r, 'ঠিকানা কী', false), null);
});

test('Similar: বানান ভুল সহ্য করে', () => {
  const r = [R({ keys: 'assalamu alaikum', reply: 's', mode: E.M_SIMILAR })];
  assert.strictEqual(E.match(r, 'assalamu alaikom', false), 's');
  assert.strictEqual(E.match(r, 'good morning', false), null);
});

test('Pattern: * চিহ্ন', () => {
  const r = [R({ keys: 'order *', reply: 'o', mode: E.M_PATTERN })];
  assert.strictEqual(E.match(r, 'Order 12345', false), 'o');
  assert.strictEqual(E.match(r, 'my order 1', false), null);
});

test('Regex: ঠিক ও ভুল রেগুলার এক্সপ্রেশন', () => {
  const r = [R({ keys: '^\\d{4}$', reply: 'n', mode: E.M_REGEX }), R({ keys: '([', reply: 'bad', mode: E.M_REGEX })];
  assert.strictEqual(E.match(r, '1234', false), 'n');
  assert.strictEqual(E.match(r, 'abc', false), null);
});

test('গ্রুপ ও ব্যক্তি সুইচ, বন্ধ নিয়ম, ক্রম', () => {
  const r = [
    R({ keys: 'ক', reply: 'গ্রুপ-নয়', person: true, group: false }),
    R({ keys: 'ক', reply: 'গ্রুপ', person: false, group: true }),
    R({ keys: 'ক', reply: 'বন্ধ', on: false })
  ];
  assert.strictEqual(E.match(r, 'ক', false), 'গ্রুপ-নয়');
  assert.strictEqual(E.match(r, 'ক', true), 'গ্রুপ');
});
