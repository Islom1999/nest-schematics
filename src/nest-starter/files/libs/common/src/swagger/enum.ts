/**
 * Swagger options for an enum property. Always give enums a name: a named
 * enum becomes one reusable schema (`$ref: '#/components/schemas/ProductStatus'`)
 * and one `ProductStatus` type in generated clients, instead of an anonymous
 * inline union on every property and parameter that uses it.
 *
 *   @ApiProperty({ ...apiEnum(ProductStatus, 'ProductStatus') })
 *   @ApiQuery({ name: 'status', required: false, ...apiEnum(ProductStatus, 'ProductStatus') })
 *
 * Use the TypeScript enum's own name. `npm run swagger:export` lists enums
 * that are still inline.
 */
export function apiEnum<E extends Record<string, string | number>>(
  enumObject: E,
  enumName: string,
): { enum: E; enumName: string } {
  return { enum: enumObject, enumName };
}
