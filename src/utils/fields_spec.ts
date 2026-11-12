import { readFileSync } from 'fs';
import { join } from 'path';
import { FieldSpec, FieldSpecError, classifyName, fieldKey, parseFields, singular, stringifyFields } from './fields';

interface Contract {
  valid: Array<{ spec: string; fields: FieldSpec[]; normalized: string; keys: string[] }>;
  invalid: Array<{ spec: string; error: string }>;
}

// Same file the frontend (fuse-schematics) tests against: see scripts/sync-fields.mjs.
const contract: Contract = JSON.parse(readFileSync(join(__dirname, 'fields-contract.json'), 'utf-8'));

function rejects(spec: string, message: RegExp | string): void {
  expect(() => parseFields(spec)).toThrowMatching(
    (e: unknown) =>
      e instanceof FieldSpecError &&
      (typeof message === 'string' ? (e as Error).message === message : message.test((e as Error).message)),
  );
}

describe('parseFields', () => {
  it('returns [] for empty input', () => {
    expect(parseFields(undefined)).toEqual([]);
    expect(parseFields('')).toEqual([]);
    expect(parseFields('  ')).toEqual([]);
  });

  describe('v1 specs (unchanged)', () => {
    it('parses name:type pairs with nullable suffix', () => {
      expect(parseFields('title:string,price:number,active:boolean,note:text?,publishedAt:date?')).toEqual([
        { name: 'title', type: 'string', nullable: false },
        { name: 'price', type: 'number', nullable: false },
        { name: 'active', type: 'boolean', nullable: false },
        { name: 'note', type: 'text', nullable: true },
        { name: 'publishedAt', type: 'date', nullable: true },
      ]);
    });

    it('tolerates spaces, upper-case types and a missing type (string)', () => {
      expect(parseFields(' title : String , slug, code? ')).toEqual([
        { name: 'title', type: 'string', nullable: false },
        { name: 'slug', type: 'string', nullable: false },
        { name: 'code', type: 'string', nullable: true },
      ]);
    });

    it('parses enum values separated by | or , inside parentheses', () => {
      expect(parseFields('status:enum(draft|published),kind:enum(a,b)?')).toEqual([
        { name: 'status', type: 'enum', nullable: false, enumValues: ['draft', 'published'] },
        { name: 'kind', type: 'enum', nullable: true, enumValues: ['a', 'b'] },
      ]);
    });

    it('round-trips through stringifyFields', () => {
      const spec = 'title:string,price:number,status:enum(draft|published)?,note:text?';
      expect(stringifyFields(parseFields(spec))).toBe(spec);
    });
  });

  describe('v2 types and modifiers', () => {
    it('parses sized strings, decimals and defaults with typed values', () => {
      expect(parseFields('code:string(32):unique,price:decimal(12,2):default(0),on:boolean:default(TRUE)')).toEqual([
        { name: 'code', type: 'string', nullable: false, length: 32, unique: true },
        { name: 'price', type: 'decimal', nullable: false, precision: 12, scale: 2, default: 0 },
        { name: 'on', type: 'boolean', nullable: false, default: true },
      ]);
    });

    it('gives decimal a default precision of (12,2) and a lone precision a scale of 0', () => {
      const [a, b] = parseFields('a:decimal,b:decimal(5)');
      expect([a.precision, a.scale, b.precision, b.scale]).toEqual([12, 2, 5, 0]);
    });

    it('parses single and many relations; the target is classified', () => {
      expect(parseFields('category:relation(category),tags:relation(Tag[])?,authors:relation(sp-user)[]')).toEqual([
        { name: 'category', type: 'relation', nullable: false, target: 'Category', many: false },
        { name: 'tags', type: 'relation', nullable: true, target: 'Tag', many: true },
        { name: 'authors', type: 'relation', nullable: false, target: 'SpUser', many: true },
      ]);
    });

    it('parses file fields with kind and list marker', () => {
      expect(parseFields('image:file(image):cascade,docs:file(pdf)[]?')).toEqual([
        { name: 'image', type: 'file', nullable: false, kind: 'image', many: false, onDelete: 'cascade' },
        { name: 'docs', type: 'file', nullable: true, kind: 'pdf', many: true },
      ]);
    });

    it('accepts ? after the type as well as at the end', () => {
      expect(parseFields('rating:number?:min(0)')).toEqual(parseFields('rating:number:min(0)?'));
    });

    it('keeps commas and colons inside parentheses (defaults)', () => {
      const [note, json] = parseFields('note:text:default(a, b: c),meta:json:default({"a":1,"b":[1,2]})');
      expect(note.default).toBe('a, b: c');
      expect(json.default).toEqual({ a: 1, b: [1, 2] });
    });

    it('normalises modifier order and list markers when stringifying', () => {
      const fields = parseFields('owner:relation(user):cascade:unique,files:file(PDF)[]:max(3)?,x:string:max(5):min(1)');
      expect(stringifyFields(fields)).toBe(
        'owner:relation(User):unique:cascade,files:file(pdf)[]:max(3)?,x:string:min(1):max(5)',
      );
      expect(parseFields(stringifyFields(fields))).toEqual(fields);
    });
  });

  describe('helpers', () => {
    it('fieldKey gives the DTO property of relations and files', () => {
      expect(parseFields('category:relation(Category),tags:relation(Tag[]),categories:relation(Category[]),image:file(image),docs:file(pdf)[],name').map(fieldKey)).toEqual([
        'categoryId',
        'tagIds',
        'categoryIds',
        'imageId',
        'docIds',
        'name',
      ]);
    });

    it('singular and classifyName', () => {
      expect(['tags', 'categories', 'news', 'status', 'media'].map(singular)).toEqual(['tag', 'category', 'news', 'status', 'media']);
      expect(['category', 'sp-year', 'SpYear', 'media_file'].map(classifyName)).toEqual(['Category', 'SpYear', 'SpYear', 'MediaFile']);
    });
  });

  describe('contract (src/utils/fields-contract.json)', () => {
    it('has examples', () => {
      expect(contract.valid.length).toBeGreaterThan(10);
      expect(contract.invalid.length).toBeGreaterThan(20);
    });

    for (const example of contract.valid) {
      it(`parses "${example.spec}"`, () => {
        const fields = parseFields(example.spec);
        expect(fields).toEqual(example.fields);
        expect(stringifyFields(fields)).toBe(example.normalized);
        expect(fields.map(fieldKey)).toEqual(example.keys);
        // The normalised form is a fixed point.
        expect(parseFields(example.normalized)).toEqual(example.fields);
        expect(JSON.parse(JSON.stringify(fields))).toEqual(fields);
      });
    }

    for (const example of contract.invalid) {
      it(`rejects "${example.spec}"`, () => rejects(example.spec, example.error));
    }
  });

  const invalid: Array<[string, RegExp]> = [
    ['price:money', /Unknown type "money"/],
    ['1abc:string', /Invalid field name/],
    ['title:string,title:text', /listed twice/],
    ['id:string', /reserved/],
    ['status:enum', /needs values/],
    ['price:number(5)', /takes no arguments/],
    ['tags:relation(Tag[]):label(name):label(title)', /listed twice/],
    ['a:string:min(-1)', /integer >= 0/],
    ['a:int:min(1.5)', /must be an integer/],
    ['a:number:max(abc)', /must be a number/],
    ['a:string:max(3):default(abcd)', /longer than 3/],
    ['a:string:min(3):default(ab)', /shorter than 3/],
  ];
  for (const [spec, message] of invalid) {
    it(`rejects "${spec}"`, () => rejects(spec, message));
  }
});
