/**
 * `operationId` = `<controller><Method>` in camelCase, from the controller
 * class name without `Controller` and the handler name:
 *
 *   ProductController.findAll         → productFindAll
 *   ProductController.findAllPagination → productFindAllPagination
 *   AuthController.signIn             → authSignIn
 *   AdminAdminsController.findOne     → adminAdminsFindOne
 *
 * Generated clients use it as the method name (`AdminProductService.productFindAll()`),
 * so it only changes when a class or handler is renamed. Class names must be
 * unique per document; `findDuplicateOperationIds()` checks that.
 */
export function operationIdFactory(controllerKey: string, methodKey: string, version?: string): string {
  const resource = lowerFirst(identifier(controllerKey.replace(/Controller$/, '')));
  // Route aliases arrive as `findAll[1]`.
  const method = identifier(methodKey);
  const id = resource ? `${resource}${upperFirst(method)}` : lowerFirst(method);
  return version ? `${id}V${identifier(version)}` : id;
}

/** `my-thing.v2[1]` → `MyThingV21`: letters and digits only, word starts upper-cased. */
function identifier(value: string): string {
  return value
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part, i) => (i === 0 ? part : upperFirst(part)))
    .join('');
}

function upperFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/** `Product` → `product`, `APIKeys` → `apiKeys`, `API` → `api`. */
function lowerFirst(value: string): string {
  return value.replace(/^[A-Z]+(?=[A-Z][a-z]|\d|$)|^[A-Z]/, (m) => m.toLowerCase());
}
