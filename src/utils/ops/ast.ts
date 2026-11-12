import { SchematicsException, Tree } from '@angular-devkit/schematics';
import * as ts from 'typescript';
import { indentOf, readText } from './text';

export interface NamedImport {
  /** Imported binding, e.g. `ThrottlerModule`. */
  name: string;
  /** Module specifier, e.g. `@nestjs/throttler` or `./foo/foo.module`. */
  from: string;
}

export function parse(path: string, text: string): ts.SourceFile {
  return ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
}

/**
 * Adds `import { name } from 'from'` unless `name` is already imported from
 * any module. Idempotent. Inserts after the last import statement.
 */
export function addNamedImports(tree: Tree, path: string, imports: NamedImport[]): boolean {
  let changed = false;
  for (const imp of imports) {
    const text = readText(tree, path);
    const source = parse(path, text);
    const declarations = source.statements.filter(ts.isImportDeclaration);
    const has = declarations.some(
      (d) =>
        !!d.importClause?.namedBindings &&
        ts.isNamedImports(d.importClause.namedBindings) &&
        d.importClause.namedBindings.elements.some((e) => e.name.text === imp.name),
    );
    if (has) continue;

    const recorder = tree.beginUpdate(path);
    // Same specifier already imported: extend its `{ ... }`.
    const sameFrom = declarations.find(
      (d) =>
        ts.isStringLiteral(d.moduleSpecifier) &&
        d.moduleSpecifier.text === imp.from &&
        !!d.importClause?.namedBindings &&
        ts.isNamedImports(d.importClause.namedBindings) &&
        !d.importClause.isTypeOnly,
    );
    if (sameFrom) {
      const named = sameFrom.importClause!.namedBindings as ts.NamedImports;
      const last = named.elements[named.elements.length - 1];
      if (last) recorder.insertRight(last.getEnd(), `, ${imp.name}`);
      else recorder.insertRight(named.getStart() + 1, ` ${imp.name} `);
    } else {
      const statement = `import { ${imp.name} } from '${imp.from}';`;
      if (declarations.length) {
        recorder.insertLeft(declarations[declarations.length - 1].getEnd(), `\n${statement}`);
      } else {
        recorder.insertLeft(0, `${statement}\n`);
      }
    }
    tree.commitUpdate(recorder);
    changed = true;
  }
  return changed;
}

/** The object literal passed to the first `@<decoratorName>({...})` in the file. */
export function findDecoratorObject(
  source: ts.SourceFile,
  decoratorName: string,
): ts.ObjectLiteralExpression | null {
  let result: ts.ObjectLiteralExpression | null = null;
  const visit = (node: ts.Node): void => {
    if (result) return;
    if (
      ts.isDecorator(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === decoratorName
    ) {
      const arg = node.expression.arguments[0];
      if (arg && ts.isObjectLiteralExpression(arg)) {
        result = arg;
        return;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return result;
}

export function findProperty(
  object: ts.ObjectLiteralExpression,
  name: string,
): ts.PropertyAssignment | undefined {
  return object.properties.find(
    (p): p is ts.PropertyAssignment =>
      ts.isPropertyAssignment(p) &&
      (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) &&
      p.name.text === name,
  );
}

/**
 * Identity of an array element used for de-duplication: the leading identifier
 * of `Foo`, `Foo.forRoot(...)`, `forwardRef(() => Foo)`, and for provider
 * objects `{ provide: APP_GUARD, useClass: Foo }` → `APP_GUARD:Foo`.
 */
export function elementKey(el: ts.Expression): string {
  if (ts.isIdentifier(el)) return el.text;
  if (ts.isCallExpression(el)) {
    const callee = el.expression;
    if (ts.isIdentifier(callee) && callee.text === 'forwardRef') {
      const fn = el.arguments[0];
      if (fn && ts.isArrowFunction(fn) && ts.isIdentifier(fn.body)) return fn.body.text;
    }
    return elementKey(callee);
  }
  if (ts.isPropertyAccessExpression(el)) return elementKey(el.expression);
  if (ts.isObjectLiteralExpression(el)) {
    const prop = (n: string) => {
      const p = findProperty(el, n);
      return p ? p.initializer.getText() : '';
    };
    const target = prop('useClass') || prop('useExisting') || prop('useValue') || prop('useFactory');
    return `${prop('provide')}:${target}`;
  }
  return el.getText();
}

/**
 * Adds `expression` to the array property `property` of the object literal
 * passed to `@<decorator>()`. Creates the property when it is missing. Keeps
 * one-per-line arrays one-per-line. Returns false when an element with the same
 * key (see {@link elementKey}) is already present.
 */
export function addToDecoratorArray(
  tree: Tree,
  path: string,
  decorator: string,
  property: string,
  expression: string,
): boolean {
  const text = readText(tree, path);
  const source = parse(path, text);
  const object = findDecoratorObject(source, decorator);
  if (!object) {
    throw new SchematicsException(`Could not find "@${decorator}({...})" in ${path}.`);
  }

  const key = elementKey(parseExpression(expression));
  const prop = findProperty(object, property);
  const recorder = tree.beginUpdate(path);

  if (!prop) {
    const props = object.properties;
    const multiline = text.slice(object.getStart(), object.getEnd()).includes('\n');
    if (!props.length) {
      recorder.insertLeft(object.getEnd() - 1, ` ${property}: [${expression}] `);
    } else {
      const last = props[props.length - 1];
      const indent = multiline ? indentOf(text, last.getStart()) : '';
      const hasTrailingComma = text.slice(last.getEnd(), object.getEnd()).trimStart().startsWith(',');
      const sep = hasTrailingComma ? '' : ',';
      const insertAt = hasTrailingComma ? text.indexOf(',', last.getEnd()) + 1 : last.getEnd();
      recorder.insertRight(
        insertAt,
        multiline ? `${sep}\n${indent}${property}: [${expression}]` : `${sep} ${property}: [${expression}]`,
      );
    }
    tree.commitUpdate(recorder);
    return true;
  }

  if (!ts.isArrayLiteralExpression(prop.initializer)) {
    throw new SchematicsException(
      `"${property}" in @${decorator}() of ${path} is not an array literal. Add ${expression} manually.`,
    );
  }
  const array = prop.initializer;
  if (array.elements.some((el) => elementKey(el) === key)) return false;

  const elements = array.elements;
  if (elements.length === 0) {
    recorder.insertLeft(array.getEnd() - 1, expression);
  } else {
    const last = elements[elements.length - 1];
    const multiline = text.slice(array.getStart(), last.getEnd()).includes('\n');
    const lineIndent = multiline ? indentOf(text, last.getStart()) : '';
    // A trailing comma after the last element stays where it is.
    const after = text.slice(last.getEnd(), array.getEnd() - 1);
    const trailing = after.trimStart().startsWith(',');
    const at = trailing ? last.getEnd() + after.indexOf(',') + 1 : last.getEnd();
    const lead = trailing ? '' : ',';
    recorder.insertRight(
      at,
      multiline ? `${lead}\n${lineIndent}${expression}${trailing ? ',' : ''}` : `${lead} ${expression}${trailing ? ',' : ''}`,
    );
  }
  tree.commitUpdate(recorder);
  return true;
}

function parseExpression(expression: string): ts.Expression {
  const source = parse('expr.ts', `(${expression});`);
  const statement = source.statements[0];
  if (!statement || !ts.isExpressionStatement(statement)) {
    throw new SchematicsException(`Not an expression: ${expression}`);
  }
  let expr = statement.expression;
  while (ts.isParenthesizedExpression(expr)) expr = expr.expression;
  return expr;
}
