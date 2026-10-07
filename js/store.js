'use strict';

// データはすべて端末内の localStorage に保存する
const Store = (() => {
  const KEY = 'myfit.v1';
  const defaults = () => ({
    version: 1,
    customExercises: [],
    workouts: [],
    routines: [],
    active: null,
    body: [],   // { date, weight, fat? }（1日1件）
    meals: [],  // { id, date, meal, name, qty, kcal, p, f, c }
    profile: { sex: 'male', age: null, height: null, activity: 1.55, goal: 'maintain', targetWeight: null },
    settings: { rest: 90 },
  });
  let data = defaults();

  function normalize(obj) {
    const d = defaults();
    if (!obj || typeof obj !== 'object') return d;
    return {
      ...d, ...obj,
      profile: { ...d.profile, ...(obj.profile || {}) },
      settings: { ...d.settings, ...(obj.settings || {}) },
    };
  }

  function load() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) data = normalize(JSON.parse(raw));
    } catch (e) {
      console.warn('load failed', e);
    }
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(data));
      return true;
    } catch (e) {
      console.warn('save failed', e);
      return false;
    }
  }

  function replace(obj) { data = normalize(obj); save(); }
  function reset() { data = defaults(); save(); }

  return { get data() { return data; }, load, save, replace, reset };
})();
