"use strict";

// Rewrite TS helper initializers like
//   var __extends = (this && this.__extends) || function(...) { ... }
// so that any `this` under the initializer becomes `globalThis`.
// This avoids "Cannot read property '__extends' of undefined" when modules
// execute in strict mode where top-level `this` is undefined.

module.exports = function fixTsHelpersThis({ types: t }) {
  const TARGET_HELPERS = new Set([
    "__extends",
    "__assign",
    "__awaiter",
    "__generator",
    "__decorate",
    "__rest",
  ]);

  return {
    name: "fix-ts-helpers-this",
    visitor: {
      VariableDeclarator(path) {
        const id = path.node.id;
        if (!t.isIdentifier(id) || !TARGET_HELPERS.has(id.name)) return;

        const initPath = path.get("init");
        if (!initPath || !initPath.node) return;

        // Replace all ThisExpression occurrences under the initializer
        initPath.traverse({
          ThisExpression(p) {
            p.replaceWith(t.identifier("globalThis"));
          },
        });
      },
    },
  };
};
