/**
 *  Copyright (c) 2019 GraphQL Contributors
 *  All rights reserved.
 *
 *  This source code is licensed under the BSD-style license found in the
 *  LICENSE file in the root directory of this source tree. An additional grant
 *  of patent rights can be found in the PATENTS file in the same directory.
 */

import CodeMirror from 'codemirror';
import {
  getNullableType,
  getNamedType,
  GraphQLEnumType,
  GraphQLInputObjectType,
  GraphQLList,
  GraphQLBoolean,
} from 'graphql';

import forEachState from '../utils/forEachState';
import hintList from '../utils/hintList';

/**
 * Registers a "hint" helper for CodeMirror.
 *
 * Using CodeMirror's "hint" addon: https://codemirror.net/demo/complete.html
 * Given an editor, this helper will take the token at the cursor and return a
 * list of suggested tokens.
 *
 * Options:
 *
 *   - variableToType: { [variable: string]: GraphQLInputType }
 *
 * Additional Events:
 *
 *   - hasCompletion (codemirror, data, token) - signaled when the hinter has a
 *     new list of completion suggestions.
 *
 */
CodeMirror.registerHelper('hint', 'graphql-variables', (editor, options) => {
  const cur = editor.getCursor();
  const token = editor.getTokenAt(cur);

  const results = getVariablesHint(cur, token, options);
  if (results && results.list && results.list.length > 0) {
    results.from = CodeMirror.Pos(results.from.line, results.from.column);
    results.to = CodeMirror.Pos(results.to.line, results.to.column);
    CodeMirror.signal(editor, 'hasCompletion', editor, results, token);
  }

  return results;
});

function getVariablesHint(cur, token, options) {
  // If currently parsing an invalid state, attempt to hint to the prior state.
  const state =
    token.state.kind === 'Invalid' ? token.state.prevState : token.state;

  const kind = state.kind;
  const step = state.step;

  // Variables can only be an object literal.
  if (kind === 'Document' && step === 0) {
    return hintList(cur, token, [{ text: '{' }]);
  }

  const variableToType = options.variableToType;
  if (!variableToType) {
    return;
  }

  const typeInfo = getTypeInfo(variableToType, token.state);

  // Top level should typeahead possible variables.
  if (kind === 'Document' || (kind === 'Variable' && step === 0)) {
    const variableNames = Object.keys(variableToType);
    return hintList(
      cur,
      token,
      variableNames.map(name => ({
        text: `"${name}": `,
        type: variableToType[name],
      })),
    );
  }

  // Input Object fields
  if (kind === 'ObjectValue' || (kind === 'ObjectField' && step === 0)) {
    if (typeInfo.fields) {
      const inputFields = Object.keys(typeInfo.fields).map(
        fieldName => typeInfo.fields[fieldName],
      );
      return hintList(
        cur,
        token,
        inputFields.map(field => ({
          text: `"${field.name}": `,
          type: field.type,
          description: field.description,
        })),
      );
    }
  }

  // Input values.
  if (
    kind === 'StringValue' ||
    kind === 'NumberValue' ||
    kind === 'BooleanValue' ||
    kind === 'NullValue' ||
    (kind === 'ListValue' && step === 1) ||
    (kind === 'ObjectField' && step === 2) ||
    (kind === 'Variable' && step === 2)
  ) {
    const namedInputType = getNamedType(typeInfo.type);
    if (namedInputType instanceof GraphQLInputObjectType) {
      return hintList(cur, token, [{ text: '{' }]);
    } else if (namedInputType instanceof GraphQLEnumType) {
      const valueMap = namedInputType.getValues();
      const values = Object.keys(valueMap).map(name => valueMap[name]);
      return hintList(
        cur,
        token,
        values.map(value => ({
          text: `"${value.name}"`,
          type: namedInputType,
          description: value.description,
        })),
      );
    } else if (namedInputType === GraphQLBoolean) {
      return hintList(cur, token, [
        { text: 'true', type: GraphQLBoolean, description: 'Not false.' },
        { text: 'false', type: GraphQLBoolean, description: 'Not true.' },
      ]);
    }
  }
}

// Utility for collecting rich type information given any token's state
// from the graphql-variables-mode parser.
function getTypeInfo(variableToType, tokenState) {
  const info = {
    type: null,
    fields: null,
  };

  forEachState(tokenState, state => {
    if (state.kind === 'Variable') {
      info.type = variableToType[state.name];
    } else if (state.kind === 'ListValue') {
      const nullableType = getNullableType(info.type);
      info.type =
        nullableType instanceof GraphQLList ? nullableType.ofType : null;
    } else if (state.kind === 'ObjectValue') {
      const objectType = getNamedType(info.type);
      info.fields =
        objectType instanceof GraphQLInputObjectType
          ? objectType.getFields()
          : null;
    } else if (state.kind === 'ObjectField') {
      const objectField =
        state.name && info.fields ? info.fields[state.name] : null;
      info.type = objectField && objectField.type;
    }
  });

  return info;
}
