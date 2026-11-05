// Lets the popup run on the Vite dev server, where chrome.storage doesn't exist. Dev builds only.
if (import.meta.env.DEV && !globalThis.chrome?.storage) {
  (globalThis as any).chrome = {
    storage: {
      local: {
        get: async (key: string) => {
          const value = localStorage.getItem(key);
          return value ? { [key]: JSON.parse(value) } : {};
        },
        set: async (items: Record<string, unknown>) => {
          for (const [key, value] of Object.entries(items)) localStorage.setItem(key, JSON.stringify(value));
        },
      },
    },
  };
}
