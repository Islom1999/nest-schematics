import { SchematicsException, Tree } from '@angular-devkit/schematics';
import * as ts from 'typescript';

/**
 * Adds `className` to the `imports: [...]` of the `@Module()` in `modulePath`
 * and an `import { className } from 'importPath'` statement. Idempotent:
 * running it twice changes nothing.
 *
 * @returns false when the class was already registered.
 */
export function addModuleImport(
  tree: Tree,
  modulePath: string,
  className: string,
  importPath: string,
): boolean {
  const buffer = tree.read(modulePath);
  if (!buffer) throw new SchematicsException(`File not found: ${modulePath}`);
  const text = buffer.toString('utf-8');
  const source = ts.createSourceFile(modulePath, text, ts.ScriptTarget.Latest, true);

  const importsArray = findModuleImportsArray(source);
  if (!importsArray) {
    throw new SchematicsException(
      `Could not find "@Module({ imports: [...] })" in ${modulePath}. Add ${className} manually.`,
    );
  }

  const alreadyListed = importsArray.elements.some(
    (el) => ts.isIdentifier(el) && el.text === className,
  );
  const alreadyImported = source.statements.some(
    (st) =>
      ts.isImportDeclaration(st) &&
      !!st.importClause?.namedBindings &&
      ts.isNamedImports(st.importClause.namedBindings) &&
      st.importClause.namedBindings.elements.some((e) => e.name.text === className),
  );
  if (alreadyListed && alreadyImported) return false;

  const recorder = tree.beginUpdate(modulePath);

  if (!alreadyListed) {
    const elements = importsArray.elements;
    if (elements.length === 0) {
      recorder.insertLeft(importsArray.getEnd() - 1, className);
    } else {
      const last = elements[elements.length - 1];
      // Keep the array's style: one-per-line arrays get a new line.
      const multiline = text.slice(importsArray.getStart(), last.getEnd()).includes('\n');
      const lineIndent = multiline ? indentOf(text, last.getStart()) : '';
      recorder.insertRight(
        last.getEnd(),
        multiline ? `,\n${lineIndent}${className}` : `, ${className}`,
      );
    }
  }

  if (!alreadyImported) {
    const imports = source.statements.filter(ts.isImportDeclaration);
    const statement = `import { ${className} } from '${importPath}';`;
    if (imports.length) {
      recorder.insertLeft(imports[imports.length - 1].getEnd(), `\n${statement}`);
    } else {
      recorder.insertLeft(0, `${statement}\n`);
    }
  }

  tree.commitUpdate(recorder);
  return true;
}

function indentOf(text: string, pos: number): string {
  const lineStart = text.lastIndexOf('\n', pos - 1) + 1;
  const match = /^[ \t]*/.exec(text.slice(lineStart, pos));
  return match ? match[0] : '';
}

function findModuleImportsArray(source: ts.SourceFile): ts.ArrayLiteralExpression | null {
  let result: ts.ArrayLiteralExpression | null = null;

  const visit = (node: ts.Node): void => {
    if (result) return;
    if (
      ts.isDecorator(node) &&
      ts.isCallExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      node.expression.expression.text === 'Module'
    ) {
      const arg = node.expression.arguments[0];
      if (arg && ts.isObjectLiteralExpression(arg)) {
        const prop = arg.properties.find(
          (p): p is ts.PropertyAssignment =>
            ts.isPropertyAssignment(p) && p.name.getText(source) === 'imports',
        );
        if (prop && ts.isArrayLiteralExpression(prop.initializer)) {
          result = prop.initializer;
          return;
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(source);
  return result;
}
