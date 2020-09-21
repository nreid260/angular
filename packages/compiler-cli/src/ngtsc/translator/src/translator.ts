/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {AssertNotNull, BinaryOperator, BinaryOperatorExpr, CastExpr, ClassStmt, CommaExpr, ConditionalExpr, DeclareFunctionStmt, DeclareVarStmt, Expression, ExpressionStatement, ExpressionVisitor, ExternalExpr, FunctionExpr, IfStmt, InstantiateExpr, InvokeFunctionExpr, InvokeMethodExpr, LeadingComment, LiteralArrayExpr, LiteralExpr, LiteralMapExpr, NotExpr, ParseSourceSpan, ReadKeyExpr, ReadPropExpr, ReadVarExpr, ReturnStatement, Statement, StatementVisitor, StmtModifier, ThrowStmt, TryCatchStmt, TypeofExpr, WrappedNodeExpr, WriteKeyExpr, WritePropExpr, WriteVarExpr} from '@angular/compiler';
import {LocalizedString, UnaryOperator, UnaryOperatorExpr} from '@angular/compiler/src/output/output_ast';
import * as ts from 'typescript';

import {DefaultImportRecorder} from '../../imports';
import {Context} from './context';
import {ImportManager} from './import_manager';

const UNARY_OPERATORS = new Map<UnaryOperator, ts.PrefixUnaryOperator>([
  [UnaryOperator.Minus, ts.SyntaxKind.MinusToken],
  [UnaryOperator.Plus, ts.SyntaxKind.PlusToken],
]);

const BINARY_OPERATORS = new Map<BinaryOperator, ts.BinaryOperator>([
  [BinaryOperator.And, ts.SyntaxKind.AmpersandAmpersandToken],
  [BinaryOperator.Bigger, ts.SyntaxKind.GreaterThanToken],
  [BinaryOperator.BiggerEquals, ts.SyntaxKind.GreaterThanEqualsToken],
  [BinaryOperator.BitwiseAnd, ts.SyntaxKind.AmpersandToken],
  [BinaryOperator.Divide, ts.SyntaxKind.SlashToken],
  [BinaryOperator.Equals, ts.SyntaxKind.EqualsEqualsToken],
  [BinaryOperator.Identical, ts.SyntaxKind.EqualsEqualsEqualsToken],
  [BinaryOperator.Lower, ts.SyntaxKind.LessThanToken],
  [BinaryOperator.LowerEquals, ts.SyntaxKind.LessThanEqualsToken],
  [BinaryOperator.Minus, ts.SyntaxKind.MinusToken],
  [BinaryOperator.Modulo, ts.SyntaxKind.PercentToken],
  [BinaryOperator.Multiply, ts.SyntaxKind.AsteriskToken],
  [BinaryOperator.NotEquals, ts.SyntaxKind.ExclamationEqualsToken],
  [BinaryOperator.NotIdentical, ts.SyntaxKind.ExclamationEqualsEqualsToken],
  [BinaryOperator.Or, ts.SyntaxKind.BarBarToken],
  [BinaryOperator.Plus, ts.SyntaxKind.PlusToken],
]);

export function translateExpression(
    expression: Expression, imports: ImportManager, defaultImportRecorder: DefaultImportRecorder,
    scriptTarget: Exclude<ts.ScriptTarget, ts.ScriptTarget.JSON>): ts.Expression {
  return expression.visitExpression(
      new ExpressionTranslatorVisitor(imports, defaultImportRecorder, scriptTarget),
      new Context(false));
}

export function translateStatement(
    statement: Statement, imports: ImportManager, defaultImportRecorder: DefaultImportRecorder,
    scriptTarget: Exclude<ts.ScriptTarget, ts.ScriptTarget.JSON>): ts.Statement {
  return statement.visitStatement(
      new ExpressionTranslatorVisitor(imports, defaultImportRecorder, scriptTarget),
      new Context(true));
}


class ExpressionTranslatorVisitor implements ExpressionVisitor, StatementVisitor {
  private externalSourceFiles = new Map<string, ts.SourceMapSource>();
  constructor(
      private imports: ImportManager, private defaultImportRecorder: DefaultImportRecorder,
      private scriptTarget: Exclude<ts.ScriptTarget, ts.ScriptTarget.JSON>) {}

  visitDeclareVarStmt(stmt: DeclareVarStmt, context: Context): ts.VariableStatement {
    const varType = this.scriptTarget < ts.ScriptTarget.ES2015 ?
        ts.NodeFlags.None :
        stmt.hasModifier(StmtModifier.Final) ? ts.NodeFlags.Const : ts.NodeFlags.Let;
    const varDeclaration = ts.createVariableDeclaration(
        /* name */ stmt.name,
        /* type */ undefined,
        /* initializer */ stmt.value?.visitExpression(this, context.withExpressionMode));
    const declarationList = ts.createVariableDeclarationList(
        /* declarations */[varDeclaration],
        /* flags */ varType);
    const varStatement = ts.createVariableStatement(undefined, declarationList);
    return attachComments(varStatement, stmt.leadingComments);
  }

  visitDeclareFunctionStmt(stmt: DeclareFunctionStmt, context: Context): ts.FunctionDeclaration {
    const fnDeclaration = ts.createFunctionDeclaration(
        /* decorators */ undefined,
        /* modifiers */ undefined,
        /* asterisk */ undefined,
        /* name */ stmt.name,
        /* typeParameters */ undefined,
        /* parameters */
        stmt.params.map(param => ts.createParameter(undefined, undefined, undefined, param.name)),
        /* type */ undefined,
        /* body */
        ts.createBlock(
            stmt.statements.map(child => child.visitStatement(this, context.withStatementMode))));
    return attachComments(fnDeclaration, stmt.leadingComments);
  }

  visitExpressionStmt(stmt: ExpressionStatement, context: Context): ts.ExpressionStatement {
    return attachComments(
        ts.createStatement(stmt.expr.visitExpression(this, context.withStatementMode)),
        stmt.leadingComments);
  }

  visitReturnStmt(stmt: ReturnStatement, context: Context): ts.ReturnStatement {
    return attachComments(
        ts.createReturn(stmt.value.visitExpression(this, context.withExpressionMode)),
        stmt.leadingComments);
  }

  visitDeclareClassStmt(stmt: ClassStmt, context: Context) {
    if (this.scriptTarget < ts.ScriptTarget.ES2015) {
      throw new Error(
          `Unsupported mode: Visiting a "declare class" statement (class ${stmt.name}) while ` +
          `targeting ${ts.ScriptTarget[this.scriptTarget]}.`);
    }
    throw new Error('Method not implemented.');
  }

  visitIfStmt(stmt: IfStmt, context: Context): ts.IfStatement {
    const thenBlock = ts.createBlock(
        stmt.trueCase.map(child => child.visitStatement(this, context.withStatementMode)));
    const elseBlock = stmt.falseCase.length > 0 ?
        ts.createBlock(
            stmt.falseCase.map(child => child.visitStatement(this, context.withStatementMode))) :
        undefined;
    const ifStatement =
        ts.createIf(stmt.condition.visitExpression(this, context), thenBlock, elseBlock);
    return attachComments(ifStatement, stmt.leadingComments);
  }

  visitTryCatchStmt(stmt: TryCatchStmt, context: Context) {
    throw new Error('Method not implemented.');
  }

  visitThrowStmt(stmt: ThrowStmt, context: Context): ts.ThrowStatement {
    return attachComments(
        ts.createThrow(stmt.error.visitExpression(this, context.withExpressionMode)),
        stmt.leadingComments);
  }

  visitReadVarExpr(ast: ReadVarExpr, context: Context): ts.Identifier {
    const identifier = ts.createIdentifier(ast.name!);
    this.setSourceMapRange(identifier, ast.sourceSpan);
    return identifier;
  }

  visitWriteVarExpr(expr: WriteVarExpr, context: Context): ts.Expression {
    const result: ts.Expression = ts.createBinary(
        ts.createIdentifier(expr.name), ts.SyntaxKind.EqualsToken,
        expr.value.visitExpression(this, context));
    return context.isStatement ? result : ts.createParen(result);
  }

  visitWriteKeyExpr(expr: WriteKeyExpr, context: Context): ts.Expression {
    const exprContext = context.withExpressionMode;
    const lhs = ts.createElementAccess(
        expr.receiver.visitExpression(this, exprContext),
        expr.index.visitExpression(this, exprContext));
    const rhs = expr.value.visitExpression(this, exprContext);
    const result: ts.Expression = ts.createBinary(lhs, ts.SyntaxKind.EqualsToken, rhs);
    return context.isStatement ? result : ts.createParen(result);
  }

  visitWritePropExpr(expr: WritePropExpr, context: Context): ts.BinaryExpression {
    return ts.createBinary(
        ts.createPropertyAccess(expr.receiver.visitExpression(this, context), expr.name),
        ts.SyntaxKind.EqualsToken, expr.value.visitExpression(this, context));
  }

  visitInvokeMethodExpr(ast: InvokeMethodExpr, context: Context): ts.CallExpression {
    const target = ast.receiver.visitExpression(this, context);
    const call = ts.createCall(
        ast.name !== null ? ts.createPropertyAccess(target, ast.name) : target, undefined,
        ast.args.map(arg => arg.visitExpression(this, context)));
    this.setSourceMapRange(call, ast.sourceSpan);
    return call;
  }

  visitInvokeFunctionExpr(ast: InvokeFunctionExpr, context: Context): ts.CallExpression {
    const expr = ts.createCall(
        ast.fn.visitExpression(this, context), undefined,
        ast.args.map(arg => arg.visitExpression(this, context)));
    if (ast.pure) {
      ts.addSyntheticLeadingComment(expr, ts.SyntaxKind.MultiLineCommentTrivia, '@__PURE__', false);
    }
    this.setSourceMapRange(expr, ast.sourceSpan);
    return expr;
  }

  visitInstantiateExpr(ast: InstantiateExpr, context: Context): ts.NewExpression {
    return ts.createNew(
        ast.classExpr.visitExpression(this, context), undefined,
        ast.args.map(arg => arg.visitExpression(this, context)));
  }

  visitLiteralExpr(ast: LiteralExpr, context: Context): ts.Expression {
    let expr: ts.Expression;
    if (ast.value === undefined) {
      expr = ts.createIdentifier('undefined');
    } else if (ast.value === null) {
      expr = ts.createNull();
    } else {
      expr = ts.createLiteral(ast.value);
    }
    this.setSourceMapRange(expr, ast.sourceSpan);
    return expr;
  }

  visitLocalizedString(ast: LocalizedString, context: Context): ts.Expression {
    const localizedString = this.scriptTarget >= ts.ScriptTarget.ES2015 ?
        this.createLocalizedStringTaggedTemplate(ast, context) :
        this.createLocalizedStringFunctionCall(ast, context);
    this.setSourceMapRange(localizedString, ast.sourceSpan);
    return localizedString;
  }

  visitExternalExpr(ast: ExternalExpr, context: Context): ts.PropertyAccessExpression
      |ts.Identifier {
    if (ast.value.name === null) {
      throw new Error(`Import unknown module or symbol ${ast.value}`);
    }
    // If a moduleName is specified, this is a normal import. If there's no module name, it's a
    // reference to a global/ambient symbol.
    if (ast.value.moduleName !== null) {
      // This is a normal import. Find the imported module.
      const {moduleImport, symbol} =
          this.imports.generateNamedImport(ast.value.moduleName, ast.value.name);
      if (moduleImport === null) {
        // The symbol was ambient after all.
        return ts.createIdentifier(symbol);
      } else {
        return ts.createPropertyAccess(
            ts.createIdentifier(moduleImport), ts.createIdentifier(symbol));
      }
    } else {
      // The symbol is ambient, so just reference it.
      return ts.createIdentifier(ast.value.name);
    }
  }

  visitConditionalExpr(ast: ConditionalExpr, context: Context): ts.ConditionalExpression {
    let cond: ts.Expression = ast.condition.visitExpression(this, context);

    // Ordinarily the ternary operator is right-associative. The following are equivalent:
    //   `a ? b : c ? d : e` => `a ? b : (c ? d : e)`
    //
    // However, occasionally Angular needs to produce a left-associative conditional, such as in
    // the case of a null-safe navigation production: `{{a?.b ? c : d}}`. This template produces
    // a ternary of the form:
    //   `a == null ? null : rest of expression`
    // If the rest of the expression is also a ternary though, this would produce the form:
    //   `a == null ? null : a.b ? c : d`
    // which, if left as right-associative, would be incorrectly associated as:
    //   `a == null ? null : (a.b ? c : d)`
    //
    // In such cases, the left-associativity needs to be enforced with parentheses:
    //   `(a == null ? null : a.b) ? c : d`
    //
    // Such parentheses could always be included in the condition (guaranteeing correct behavior) in
    // all cases, but this has a code size cost. Instead, parentheses are added only when a
    // conditional expression is directly used as the condition of another.
    //
    // TODO(alxhub): investigate better logic for precendence of conditional operators
    if (ast.condition instanceof ConditionalExpr) {
      // The condition of this ternary needs to be wrapped in parentheses to maintain
      // left-associativity.
      cond = ts.createParen(cond);
    }

    return ts.createConditional(
        cond, ast.trueCase.visitExpression(this, context),
        ast.falseCase!.visitExpression(this, context));
  }

  visitNotExpr(ast: NotExpr, context: Context): ts.PrefixUnaryExpression {
    return ts.createPrefix(
        ts.SyntaxKind.ExclamationToken, ast.condition.visitExpression(this, context));
  }

  visitAssertNotNullExpr(ast: AssertNotNull, context: Context): ts.NonNullExpression {
    return ast.condition.visitExpression(this, context);
  }

  visitCastExpr(ast: CastExpr, context: Context): ts.Expression {
    return ast.value.visitExpression(this, context);
  }

  visitFunctionExpr(ast: FunctionExpr, context: Context): ts.FunctionExpression {
    return ts.createFunctionExpression(
        undefined, undefined, ast.name || undefined, undefined,
        ast.params.map(
            param => ts.createParameter(
                undefined, undefined, undefined, param.name, undefined, undefined, undefined)),
        undefined, ts.createBlock(ast.statements.map(stmt => stmt.visitStatement(this, context))));
  }

  visitUnaryOperatorExpr(ast: UnaryOperatorExpr, context: Context): ts.Expression {
    if (!UNARY_OPERATORS.has(ast.operator)) {
      throw new Error(`Unknown unary operator: ${UnaryOperator[ast.operator]}`);
    }
    return ts.createPrefix(
        UNARY_OPERATORS.get(ast.operator)!, ast.expr.visitExpression(this, context));
  }

  visitBinaryOperatorExpr(ast: BinaryOperatorExpr, context: Context): ts.Expression {
    if (!BINARY_OPERATORS.has(ast.operator)) {
      throw new Error(`Unknown binary operator: ${BinaryOperator[ast.operator]}`);
    }
    return ts.createBinary(
        ast.lhs.visitExpression(this, context), BINARY_OPERATORS.get(ast.operator)!,
        ast.rhs.visitExpression(this, context));
  }

  visitReadPropExpr(ast: ReadPropExpr, context: Context): ts.PropertyAccessExpression {
    return ts.createPropertyAccess(ast.receiver.visitExpression(this, context), ast.name);
  }

  visitReadKeyExpr(ast: ReadKeyExpr, context: Context): ts.ElementAccessExpression {
    return ts.createElementAccess(
        ast.receiver.visitExpression(this, context), ast.index.visitExpression(this, context));
  }

  visitLiteralArrayExpr(ast: LiteralArrayExpr, context: Context): ts.ArrayLiteralExpression {
    const expr =
        ts.createArrayLiteral(ast.entries.map(expr => expr.visitExpression(this, context)));
    this.setSourceMapRange(expr, ast.sourceSpan);
    return expr;
  }

  visitLiteralMapExpr(ast: LiteralMapExpr, context: Context): ts.ObjectLiteralExpression {
    const entries = ast.entries.map(
        entry => ts.createPropertyAssignment(
            entry.quoted ? ts.createLiteral(entry.key) : ts.createIdentifier(entry.key),
            entry.value.visitExpression(this, context)));
    const expr = ts.createObjectLiteral(entries);
    this.setSourceMapRange(expr, ast.sourceSpan);
    return expr;
  }

  visitCommaExpr(ast: CommaExpr, context: Context): never {
    throw new Error('Method not implemented.');
  }

  visitWrappedNodeExpr(ast: WrappedNodeExpr<any>, context: Context): any {
    if (ts.isIdentifier(ast.node)) {
      this.defaultImportRecorder.recordUsedIdentifier(ast.node);
    }
    return ast.node;
  }

  visitTypeofExpr(ast: TypeofExpr, context: Context): ts.TypeOfExpression {
    return ts.createTypeOf(ast.expr.visitExpression(this, context));
  }

  /**
   * Translate the `LocalizedString` node into a `TaggedTemplateExpression` for ES2015 formatted
   * output.
   */
  private createLocalizedStringTaggedTemplate(ast: LocalizedString, context: Context):
      ts.TaggedTemplateExpression {
    let template: ts.TemplateLiteral;
    const length = ast.messageParts.length;
    const metaBlock = ast.serializeI18nHead();
    if (length === 1) {
      template = ts.createNoSubstitutionTemplateLiteral(metaBlock.cooked, metaBlock.raw);
      this.setSourceMapRange(template, ast.getMessagePartSourceSpan(0));
    } else {
      // Create the head part
      const head = ts.createTemplateHead(metaBlock.cooked, metaBlock.raw);
      this.setSourceMapRange(head, ast.getMessagePartSourceSpan(0));
      const spans: ts.TemplateSpan[] = [];
      // Create the middle parts
      for (let i = 1; i < length - 1; i++) {
        const resolvedExpression = ast.expressions[i - 1].visitExpression(this, context);
        this.setSourceMapRange(resolvedExpression, ast.getPlaceholderSourceSpan(i - 1));
        const templatePart = ast.serializeI18nTemplatePart(i);
        const templateMiddle = createTemplateMiddle(templatePart.cooked, templatePart.raw);
        this.setSourceMapRange(templateMiddle, ast.getMessagePartSourceSpan(i));
        const templateSpan = ts.createTemplateSpan(resolvedExpression, templateMiddle);
        spans.push(templateSpan);
      }
      // Create the tail part
      const resolvedExpression = ast.expressions[length - 2].visitExpression(this, context);
      this.setSourceMapRange(resolvedExpression, ast.getPlaceholderSourceSpan(length - 2));
      const templatePart = ast.serializeI18nTemplatePart(length - 1);
      const templateTail = createTemplateTail(templatePart.cooked, templatePart.raw);
      this.setSourceMapRange(templateTail, ast.getMessagePartSourceSpan(length - 1));
      spans.push(ts.createTemplateSpan(resolvedExpression, templateTail));
      // Put it all together
      template = ts.createTemplateExpression(head, spans);
    }
    const expression = ts.createTaggedTemplate(ts.createIdentifier('$localize'), template);
    this.setSourceMapRange(expression, ast.sourceSpan);
    return expression;
  }

  /**
   * Translate the `LocalizedString` node into a `$localize` call using the imported
   * `__makeTemplateObject` helper for ES5 formatted output.
   */
  private createLocalizedStringFunctionCall(ast: LocalizedString, context: Context) {
    // A `$localize` message consists `messageParts` and `expressions`, which get interleaved
    // together. The interleaved pieces look like:
    // `[messagePart0, expression0, messagePart1, expression1, messagePart2]`
    //
    // Note that there is always a message part at the start and end, and so therefore
    // `messageParts.length === expressions.length + 1`.
    //
    // Each message part may be prefixed with "metadata", which is wrapped in colons (:) delimiters.
    // The metadata is attached to the first and subsequent message parts by calls to
    // `serializeI18nHead()` and `serializeI18nTemplatePart()` respectively.

    // The first message part (i.e. `ast.messageParts[0]`) is used to initialize `messageParts`
    // array.
    const messageParts = [ast.serializeI18nHead()];
    const expressions: any[] = [];

    // The rest of the `ast.messageParts` and each of the expressions are `ast.expressions` pushed
    // into the arrays. Note that `ast.messagePart[i]` corresponds to `expressions[i-1]`
    for (let i = 1; i < ast.messageParts.length; i++) {
      expressions.push(ast.expressions[i - 1].visitExpression(this, context));
      messageParts.push(ast.serializeI18nTemplatePart(i));
    }

    // The resulting downlevelled tagged template string uses a call to the `__makeTemplateObject()`
    // helper, so we must ensure it has been imported.
    const {moduleImport, symbol} =
        this.imports.generateNamedImport('tslib', '__makeTemplateObject');
    const __makeTemplateObjectHelper = (moduleImport === null) ?
        ts.createIdentifier(symbol) :
        ts.createPropertyAccess(ts.createIdentifier(moduleImport), ts.createIdentifier(symbol));

    // Generate the call in the form:
    // `$localize(__makeTemplateObject(cookedMessageParts, rawMessageParts), ...expressions);`
    const cookedLiterals = messageParts.map(
        (messagePart, i) =>
            this.createLiteral(messagePart.cooked, ast.getMessagePartSourceSpan(i)));
    const rawLiterals = messageParts.map(
        (messagePart, i) => this.createLiteral(messagePart.raw, ast.getMessagePartSourceSpan(i)));
    return ts.createCall(
        /* expression */ ts.createIdentifier('$localize'),
        /* typeArguments */ undefined,
        /* argumentsArray */[
          ts.createCall(
              /* expression */ __makeTemplateObjectHelper,
              /* typeArguments */ undefined,
              /* argumentsArray */
              [
                ts.createArrayLiteral(cookedLiterals),
                ts.createArrayLiteral(rawLiterals),
              ]),
          ...expressions,
        ]);
  }


  private setSourceMapRange(expr: ts.Node, sourceSpan: ParseSourceSpan|null) {
    if (sourceSpan) {
      const {start, end} = sourceSpan;
      const {url, content} = start.file;
      if (url) {
        if (!this.externalSourceFiles.has(url)) {
          this.externalSourceFiles.set(url, ts.createSourceMapSource(url, content, pos => pos));
        }
        const source = this.externalSourceFiles.get(url);
        ts.setSourceMapRange(expr, {pos: start.offset, end: end.offset, source});
      }
    }
  }

  private createLiteral(text: string, span: ParseSourceSpan|null) {
    const literal = ts.createStringLiteral(text);
    this.setSourceMapRange(literal, span);
    return literal;
  }
}

// HACK: Use this in place of `ts.createTemplateMiddle()`.
// Revert once https://github.com/microsoft/TypeScript/issues/35374 is fixed
function createTemplateMiddle(cooked: string, raw: string): ts.TemplateMiddle {
  const node: ts.TemplateLiteralLikeNode = ts.createTemplateHead(cooked, raw);
  (node.kind as ts.SyntaxKind) = ts.SyntaxKind.TemplateMiddle;
  return node as ts.TemplateMiddle;
}

// HACK: Use this in place of `ts.createTemplateTail()`.
// Revert once https://github.com/microsoft/TypeScript/issues/35374 is fixed
function createTemplateTail(cooked: string, raw: string): ts.TemplateTail {
  const node: ts.TemplateLiteralLikeNode = ts.createTemplateHead(cooked, raw);
  (node.kind as ts.SyntaxKind) = ts.SyntaxKind.TemplateTail;
  return node as ts.TemplateTail;
}

/**
 * Attach the given `leadingComments` to the `statement` node.
 *
 * @param statement The statement that will have comments attached.
 * @param leadingComments The comments to attach to the statement.
 */
export function attachComments<T extends ts.Statement>(
    statement: T, leadingComments?: LeadingComment[]): T {
  if (leadingComments === undefined) {
    return statement;
  }

  for (const comment of leadingComments) {
    const commentKind = comment.multiline ? ts.SyntaxKind.MultiLineCommentTrivia :
                                            ts.SyntaxKind.SingleLineCommentTrivia;
    if (comment.multiline) {
      ts.addSyntheticLeadingComment(
          statement, commentKind, comment.toString(), comment.trailingNewline);
    } else {
      for (const line of comment.text.split('\n')) {
        ts.addSyntheticLeadingComment(statement, commentKind, line, comment.trailingNewline);
      }
    }
  }
  return statement;
}
