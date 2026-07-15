import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import ts from 'typescript';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceExtensions = ['.ts', '.tsx'];

function findSourceFile(candidate) {
  if (path.extname(candidate)) return existsSync(candidate) ? candidate : null;

  for (const extension of sourceExtensions) {
    const sourceFile = `${candidate}${extension}`;
    if (existsSync(sourceFile)) return sourceFile;
  }

  return null;
}

export async function resolve(specifier, context, nextResolve) {
  let candidate = null;

  if (specifier.startsWith('@/')) {
    candidate = findSourceFile(path.resolve(webRoot, 'src', specifier.slice(2)));
  } else if (
    context.parentURL?.startsWith('file:') &&
    (specifier.startsWith('./') || specifier.startsWith('../'))
  ) {
    candidate = findSourceFile(
      path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier),
    );
  }

  if (candidate) {
    return { url: pathToFileURL(candidate).href, shortCircuit: true };
  }

  return nextResolve(specifier, context);
}

export async function load(url, context, nextLoad) {
  if (/\.tsx?$/.test(url)) {
    const source = await readFile(fileURLToPath(url), 'utf8');
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: true,
        isolatedModules: true,
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        moduleResolution: ts.ModuleResolutionKind.Bundler,
        target: ts.ScriptTarget.ES2022,
      },
      fileName: fileURLToPath(url),
    });

    return { format: 'module', source: outputText, shortCircuit: true };
  }

  return nextLoad(url, context);
}
