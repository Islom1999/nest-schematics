import { readFileSync } from 'fs';
import { join } from 'path';
import * as ts from 'typescript';
import { createRunner, createStarterTree } from '../testing/starter-tree';

/**
 * The Swagger helpers live in the starter template (libs/common/src/swagger).
 * The dependency-free ones are transpiled and loaded here, so their logic is
 * tested without a generated project.
 */
const SWAGGER_DIR = join(__dirname, 'files/libs/common/src/swagger');

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function load(file: string): any {
  const source = readFileSync(join(SWAGGER_DIR, file), 'utf-8');
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  const module = { exports: {} as Record<string, unknown> };
  new Function('exports', 'require', 'module', outputText)(module.exports, require, module);
  return module.exports;
}

const { operationIdFactory } = load('operation-id.ts');
const { documentForPath, splitDocument, sortOpenApi, findDuplicateOperationIds, findInlineEnums } = load('document.ts');
const { isSwaggerExport, prepareSwaggerExport } = load('export-mode.ts');
const { swaggerBasicAuth } = load('basic-auth.ts');

const CRUD_METHODS = [
  'findAll',
  'findAllPagination',
  'findAllPaginationArchive',
  'findOneArchive',
  'findOne',
  'create',
  'update',
  'delete',
  'repair',
  'remove',
  'restore',
];

const SPECS = [
  { name: 'admin', title: 'Admin', prefixes: ['admin', 'auth'] },
  { name: 'client', title: 'Client', prefixes: ['auth/client'], fallback: true },
];

function op(operationId: string, tags: string[], ref?: string) {
  return {
    operationId,
    tags,
    responses: ref ? { 200: { content: { 'application/json': { schema: { $ref: `#/components/schemas/${ref}` } } } } } : {},
  };
}

describe('swagger helpers (starter libs/common/src/swagger)', () => {
  describe('operationIdFactory', () => {
    it('gives <controller><Method> in camelCase', () => {
      expect(operationIdFactory('ProductController', 'findAll')).toBe('productFindAll');
      expect(operationIdFactory('ProductController', 'create')).toBe('productCreate');
      expect(operationIdFactory('AuthController', 'signIn')).toBe('authSignIn');
      expect(operationIdFactory('AdminAdminsController', 'findOne')).toBe('adminAdminsFindOne');
      expect(operationIdFactory('SpYearController', 'findAllPaginationArchive')).toBe('spYearFindAllPaginationArchive');
      expect(operationIdFactory('APIKeysController', 'findAll')).toBe('apiKeysFindAll');
      expect(operationIdFactory('ApiController', 'health')).toBe('apiHealth');
    });

    it('handles route aliases, versions and anonymous controllers', () => {
      expect(operationIdFactory('ProductController', 'findAll[1]')).toBe('productFindAll1');
      expect(operationIdFactory('ProductController', 'findAll', '2')).toBe('productFindAllV2');
      expect(operationIdFactory('', 'health')).toBe('health');
    });

    it('has no collisions across the CRUD base routes and auth', () => {
      const ids = [
        ...['ProductController', 'CategoryController', 'AdminAdminsController'].flatMap((c) =>
          CRUD_METHODS.map((m) => operationIdFactory(c, m)),
        ),
        ...['signIn', 'signInWithToken', 'refresh', 'me', 'logout', 'sessions'].map((m) =>
          operationIdFactory('AuthController', m),
        ),
      ];
      expect(new Set(ids).size).toBe(ids.length);
    });
  });

  describe('documentForPath', () => {
    it('splits by the prefix after the global prefix; longest prefix wins', () => {
      expect(documentForPath('/api/admin/product/{id}', SPECS, 'api')).toBe('admin');
      expect(documentForPath('/api/admin', SPECS, 'api')).toBe('admin');
      expect(documentForPath('/api/auth/sign-in', SPECS, 'api')).toBe('admin');
      expect(documentForPath('/api/auth/client/otp', SPECS, 'api')).toBe('client');
      expect(documentForPath('/api/administrators', SPECS, 'api')).toBe('client');
      expect(documentForPath('/api', SPECS, 'api')).toBe('client');
      expect(documentForPath('/api/product', SPECS, 'api')).toBe('client');
      expect(documentForPath('/admin/x', SPECS)).toBe('admin');
    });

    it('returns null without a fallback document', () => {
      expect(documentForPath('/api/other', [SPECS[0]], 'api')).toBeNull();
    });
  });

  describe('splitDocument', () => {
    const full = {
      openapi: '3.0.0',
      info: { title: 'Full', version: '1.0', description: 'all' },
      components: {
        securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } },
        schemas: {
          PaginatedProduct: { type: 'object', properties: { count: { type: 'number' }, data: { type: 'array', items: { $ref: '#/components/schemas/Product' } } } },
          Product: { type: 'object', properties: { name: { type: 'string' }, status: { $ref: '#/components/schemas/ProductStatus' } } },
          ProductStatus: { type: 'string', enum: ['draft', 'published'] },
          Banner: { type: 'object', properties: { url: { type: 'string' } } },
        },
      },
      paths: {
        '/api/admin/product/pagination': { post: op('productFindAllPagination', ['admin/product'], 'PaginatedProduct') },
        '/api/auth/sign-in': { post: op('authSignIn', ['auth']) },
        '/api/banner': { get: op('bannerFindAll', ['banner'], 'Banner') },
        '/api': { get: op('apiHealth', ['health']) },
      },
      tags: [{ name: 'admin/product' }, { name: 'banner' }, { name: 'unused' }],
    };

    it('puts each path in one document with only the schemas it uses', () => {
      const docs = splitDocument(full, SPECS, 'api');
      expect(Object.keys(docs.admin.paths)).toEqual(['/api/admin/product/pagination', '/api/auth/sign-in']);
      expect(Object.keys(docs.client.paths)).toEqual(['/api', '/api/banner']);
      expect(Object.keys(docs.admin.components.schemas)).toEqual(['PaginatedProduct', 'Product', 'ProductStatus']);
      expect(Object.keys(docs.client.components.schemas)).toEqual(['Banner']);
      expect(docs.admin.components.securitySchemes.bearer).toBeDefined();
      expect(docs.admin.info.title).toBe('Admin');
      expect(docs.client.tags).toEqual([{ name: 'banner' }]);
      expect(full.components.schemas.Banner).toBeDefined();
    });

    it('sorts keys but keeps the property order of schemas', () => {
      const sorted = sortOpenApi({ b: 1, a: { properties: { z: { type: 'string', example: 'x' }, y: {} } } });
      expect(Object.keys(sorted)).toEqual(['a', 'b']);
      expect(Object.keys(sorted.a.properties)).toEqual(['z', 'y']);
      expect(Object.keys(sorted.a.properties.z)).toEqual(['example', 'type']);
      const docs = splitDocument(full, SPECS, 'api');
      expect(JSON.stringify(splitDocument(full, SPECS, 'api'))).toBe(JSON.stringify(docs));
    });
  });

  describe('checks', () => {
    it('finds duplicate operationIds', () => {
      const doc = {
        paths: {
          '/a': { get: op('productFindAll', []) },
          '/b': { get: op('productFindAll', []), post: op('productCreate', []) },
        },
      };
      expect(findDuplicateOperationIds(doc)).toEqual(['productFindAll: GET /a, GET /b']);
    });

    it('finds inline enums but not named ones', () => {
      const doc = {
        components: {
          schemas: {
            ProductStatus: { type: 'string', enum: ['a'] },
            Product: {
              type: 'object',
              properties: { status: { $ref: '#/components/schemas/ProductStatus' }, kind: { type: 'string', enum: ['x'] } },
            },
          },
        },
        paths: {
          '/p': { get: { parameters: [{ name: 'kind', in: 'query', schema: { type: 'string', enum: ['x'] } }], responses: {} } },
        },
      };
      expect(findInlineEnums(doc)).toEqual(['Product.kind', 'GET /p (kind)']);
    });
  });

  describe('export mode', () => {
    const keys = ['SWAGGER_EXPORT', 'DB_HOST', 'ADMIN_JWT_SECRET'];
    let saved: Record<string, string | undefined>;
    beforeEach(() => (saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]))));
    afterEach(() => {
      for (const k of keys) {
        if (saved[k] === undefined) delete process.env[k];
        else process.env[k] = saved[k];
      }
    });

    it('sets the flag and fills only missing keys', () => {
      delete process.env.SWAGGER_EXPORT;
      expect(isSwaggerExport()).toBeFalse();
      process.env.DB_HOST = 'db.internal';
      delete process.env.ADMIN_JWT_SECRET;
      prepareSwaggerExport();
      expect(isSwaggerExport()).toBeTrue();
      expect(process.env.DB_HOST).toBe('db.internal');
      expect(process.env.ADMIN_JWT_SECRET!.length).toBeGreaterThanOrEqual(32);
    });
  });

  describe('swaggerBasicAuth', () => {
    function call(header?: string) {
      const res = { code: 0, headers: {} as Record<string, string>, setHeader(k: string, v: string) { this.headers[k] = v; }, status(c: number) { this.code = c; return this; }, send() { return this; } };
      let passed = false;
      swaggerBasicAuth('docs', 's3cret')({ headers: { authorization: header } }, res, () => (passed = true));
      return { passed, res };
    }
    const basic = (v: string) => `Basic ${Buffer.from(v).toString('base64')}`;

    it('lets valid credentials through and asks for them otherwise', () => {
      expect(call(basic('docs:s3cret')).passed).toBeTrue();
      const wrong = call(basic('docs:nope'));
      expect(wrong.passed).toBeFalse();
      expect(wrong.res.code).toBe(401);
      expect(wrong.res.headers['WWW-Authenticate']).toContain('Basic');
      expect(call().passed).toBeFalse();
    });
  });
});

describe('starter Swagger contract', () => {
  it('ships the export script, the docs config and the env keys', async () => {
    const tree = await createStarterTree(createRunner());
    const pkg = JSON.parse(tree.readContent('/package.json'));
    expect(pkg.scripts['swagger:export']).toContain('apps/api/src/config/swagger-export.ts');
    const swagger = tree.readContent('/apps/api/src/config/swagger.ts');
    expect(swagger).toContain(`name: 'admin'`);
    expect(swagger).toContain(`name: 'client'`);
    expect(swagger).toContain('// @ns:swagger-admin');
    expect(swagger).toContain('// @ns:swagger-client');
    expect(swagger).toContain('operationIdFactory');
    expect(swagger).toContain(`'bearer')`);
    expect(swagger).not.toMatch(/SWAGGER_PASSWORD\s*\?\?\s*'/);
    expect(tree.exists('/apps/api/src/config/swagger-export.ts')).toBeTrue();
    expect(tree.readContent('/libs/common/src/index.ts')).toContain(`export * from './swagger';`);
    expect(tree.readContent('/libs/database/src/database.config.ts')).toContain('manualInitialization: isSwaggerExport()');
    const env = tree.readContent('/.env.example');
    expect(env).toContain('SWAGGER_USER=');
    expect(env).toContain('SWAGGER_PASSWORD=');
    expect(tree.readContent('/libs/common/src/config/env.validation.ts')).toContain('SWAGGER_PASSWORD?: string;');
    expect(tree.readContent('/apps/api/src/main.ts')).toContain('setupSwagger(app)');
  });
});
