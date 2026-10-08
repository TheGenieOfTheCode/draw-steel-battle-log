const ctlib = () => game.modules.get('draw-steel-ctlib')?.api;

export const primaryGM = () => ctlib()?.primaryGM?.() ?? game.users.activeGM ?? null;

export const isDirector = () => primaryGM()?.isSelf === true;
