// Lets the popup run on the Vite dev server, where chrome.storage doesn't exist. Dev builds only.
if (import.meta.env.DEV && !globalThis.chrome?.storage) {
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (key: string | null) => {
          const keys = key === null ? Object.keys(localStorage) : [key];
          const items: Record<string, unknown> = {};
          for (const k of keys) {
            const value = localStorage.getItem(k);
            if (value) items[k] = JSON.parse(value);
          }
          return items;
        },
        set: async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) localStorage.setItem(key, JSON.stringify(value));
        },
        remove: async (keys: string[]) => {
          for (const key of keys) localStorage.removeItem(key);
        },
      },
    },
  };
}
