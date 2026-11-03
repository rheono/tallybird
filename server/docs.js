// API docs the developer published "for the mobile app later". They list
// every route, including the internal admin ones the UI never links to.
export function openApiSpec() {
  return {
    openapi: '3.0.3',
    info: { title: 'Tallybird API', version: '0.4.2', description: 'Backend routes for the Tallybird web app.' },
    servers: [{ url: '/' }],
    components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } },
    security: [{ bearer: [] }],
    paths: {
      '/api/invoices': {
        get: { summary: 'List my invoices' },
        post: { summary: 'Create an invoice' },
      },
      '/api/invoices/{id}': {
        get: { summary: 'Get one invoice', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }] },
      },
      '/api/ai/draft-reminder': {
        post: { summary: 'Draft a payment reminder email with AI' },
      },
      '/api/admin/users': {
        get: { summary: 'List all users (admin dashboard)', 'x-internal': true, parameters: [{ name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } }, { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } }] },
      },
      '/api/admin/stats': {
        get: { summary: 'Revenue and usage numbers (admin dashboard)', 'x-internal': true },
      },
    },
  };
}

export function docsPage() {
  const spec = openApiSpec();
  const rows = Object.entries(spec.paths)
    .flatMap(([path, ops]) => Object.entries(ops).map(([method, op]) => `<tr><td><code>${method.toUpperCase()}</code></td><td><code>${path}</code></td><td>${op.summary}${op['x-internal'] ? ' <em>(internal)</em>' : ''}</td></tr>`))
    .join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Tallybird API</title>
<style>body{font-family:system-ui,sans-serif;max-width:760px;margin:40px auto;padding:0 16px;color:#1f2937}td{padding:6px 12px;border-bottom:1px solid #e5e7eb}code{font-size:14px}</style></head>
<body><h1>Tallybird API</h1><p>Version ${spec.info.version}. Machine-readable spec: <a href="/api/openapi.json">/api/openapi.json</a></p>
<table>${rows}</table></body></html>`;
}
