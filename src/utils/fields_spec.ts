import { FieldSpecError, parseFields, stringifyFields } from './fields';

describe('parseFields', () => {
  it('returns [] for empty input', () => {
    expect(parseFields(undefined)).toEqual([]);
    expect(parseFields('')).toEqual([]);
    expect(parseFields('  ')).toEqual([]);
  });

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

  const invalid: Array<[string, RegExp]> = [
    ['price:money', /Unknown type "money"/],
    ['1abc:string', /Invalid field name/],
    ['my-field:string', /Invalid field name/],
    ['title:string,title:text', /listed twice/],
    ['id:string', /reserved/],
    ['createdAt:date', /reserved/],
    ['status:enum', /needs values/],
    ['status:enum()', /needs values/],
    ['status:enum(a b)', /Invalid enum value/],
    ['title:string(5)', /Only enum fields/],
    [':string', /Invalid field/],
  ];
  for (const [spec, message] of invalid) {
    it(`rejects "${spec}"`, () => {
      expect(() => parseFields(spec)).toThrowMatching(
        (e: unknown) => e instanceof FieldSpecError && message.test((e as Error).message),
      );
    });
  }
});
