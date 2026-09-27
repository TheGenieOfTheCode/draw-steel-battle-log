

export const OLD_ID = 'draw-steel-chat-polish';

export const migrateLocalStorage = (newId) => {
  let moved = 0;
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(`${OLD_ID}.`)) continue;
      const target = `${newId}.${key.slice(OLD_ID.length + 1)}`;
      if (localStorage.getItem(target) !== null) continue;
      localStorage.setItem(target, localStorage.getItem(key));
      moved++;
    }
  } catch {  }
  if (moved) console.log(`${newId} | carried ${moved} setting(s) over from the old module name`);
  return moved;
};

export const migrateWorldSettings = async (newId, key) => {
  if (!game.user.isGM) return false;
  try {
    const current = game.settings.get(newId, key);
    if (Array.isArray(current) ? current.length : current) return false;

    const old = game.settings.storage.get('world')?.getSetting(`${OLD_ID}.${key}`);
    const value = old?.value;
    if (!value || (Array.isArray(value) && !value.length)) return false;

    await game.settings.set(newId, key, value);
    console.log(`${newId} | carried ${Array.isArray(value) ? value.length : 1} record(s) of ${key} over from the old module name`);
    return true;
  } catch (err) {
    console.warn(`${newId} | could not carry ${key} over from the old module name:`, err);
    return false;
  }
};
