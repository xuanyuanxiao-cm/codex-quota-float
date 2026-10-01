exports.offlineTibo = { source: { source: 'fixture', configured: () => true, canTranslate: () => false, loadPage: async () => ({ records: [], cursor: null, coverage: 'Offline fixture' }) } };
