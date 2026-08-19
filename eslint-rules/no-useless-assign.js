/**
 * @fileoverview Prevent useless assignment.
 * @author Erik Desjardins
 * @copyright 2016 Erik Desjardins. All rights reserved.
 * See LICENSE file in root directory for full license.
 */
// Vendored from eslint-plugin-no-useless-assign@1.0.3. Logic unchanged; wrapper
// modernized for ESLint 10. See index.js in this directory.
'use strict';

export default {
	meta: { type: 'suggestion', schema: [] },
	create,
};

function create(context) {
	var scopes = [];
	var sourceCode = context.sourceCode;

	function enterScope(node) {
		scopes.push({});
		// for params
		addDeclaredVariables(node);
	}

	function exitScope() {
		scopes.pop();
	}

	function addDeclaredVariables(node) {
		var thisScope = scopes[scopes.length - 1];
		// was `context.getDeclaredVariables(node)`, removed in ESLint 9.
		sourceCode.getDeclaredVariables(node).forEach(function(varDecl) {
			thisScope[varDecl.name] = true;
		});
	}

	function nodeBefore(node) {
		var parent = node.parent;
		var siblings;

		if (parent.type === 'SwitchCase') {
			siblings = parent.consequent;
		} else { // BlockStatement
			siblings = parent.body;
		}

		if (!siblings) {
			return null;
		}

		for (var i = 0; i < siblings.length - 1; ++i) {
			if (siblings[i + 1] === node) {
				return siblings[i];
			}
		}
		return null;
	}

	function checkForRedundantVar(declar, name) {
		var lastVar = declar.declarations[declar.declarations.length - 1];

		if (lastVar && lastVar.id.name === name) {
			context.report({
				node: lastVar,
				message: 'Redundant variable.'
			});
		}
	}

	function checkForUselessAssignment(assignment, name) {
		var left = assignment.expression.left;

		if (left.type !== 'Identifier') {
			return;
		}

		if (left.name !== name) {
			return;
		}

		if (!scopes[scopes.length - 1][name]) {
			// variable not declared in scope
			return;
		}

		context.report({
			node: left,
			message: 'Useless assignment.'
		});
	}

	function checkReturnStatement(node) {
		if (!node.argument) {
			return;
		}

		if (node.argument.type !== 'Identifier') {
			return;
		}

		var name = node.argument.name;
		var prevNode = nodeBefore(node);

		if (!prevNode) {
			return;
		}

		if (prevNode.type === 'VariableDeclaration') {
			checkForRedundantVar(prevNode, name);
		} else if (
			prevNode.type === 'ExpressionStatement' &&
			prevNode.expression.type === 'AssignmentExpression' &&
			prevNode.expression.operator === '='
		) {
			checkForUselessAssignment(prevNode, name);
		}
	}

	return {
		Program: enterScope,
		FunctionDeclaration: enterScope,
		FunctionExpression: enterScope,
		ArrowFunctionExpression: enterScope,

		'Program:exit': exitScope,
		'FunctionDeclaration:exit': exitScope,
		'FunctionExpression:exit': exitScope,
		'ArrowFunctionExpression:exit': exitScope,

		VariableDeclaration: addDeclaredVariables,

		ReturnStatement: checkReturnStatement
	};
}
