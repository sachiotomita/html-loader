import { stringifyRequest } from 'loader-utils';

const GET_SOURCE_FROM_IMPORT_NAME = '___HTML_LOADER_GET_SOURCE_FROM_IMPORT___';

export function pluginRunner(plugins) {
  return {
    process: (content) => {
      const result = { messages: [] };

      for (const plugin of plugins) {
        // eslint-disable-next-line no-param-reassign
        content = plugin(content, result);
      }

      result.html = content;

      return result;
    },
  };
}

function isASCIIWhitespace(character) {
  return (
    // Horizontal tab
    character === '\u0009' ||
    // New line
    character === '\u000A' ||
    // Form feed
    character === '\u000C' ||
    // Carriage return
    character === '\u000D' ||
    // Space
    character === '\u0020'
  );
}

// (Don't use \s, to avoid matching non-breaking space)
// eslint-disable-next-line no-control-regex
const regexLeadingSpaces = /^[ \t\n\r\u000c]+/;
// eslint-disable-next-line no-control-regex
const regexLeadingCommasOrSpaces = /^[, \t\n\r\u000c]+/;
// eslint-disable-next-line no-control-regex
const regexLeadingNotSpaces = /^[^ \t\n\r\u000c]+/;
const regexTrailingCommas = /[,]+$/;
const regexNonNegativeInteger = /^\d+$/;

// ( Positive or negative or unsigned integers or decimals, without or without exponents.
// Must include at least one digit.
// According to spec tests any decimal point must be followed by a digit.
// No leading plus sign is allowed.)
// https://html.spec.whatwg.org/multipage/infrastructure.html#valid-floating-point-number
const regexFloatingPoint = /^-?(?:[0-9]+|[0-9]*\.[0-9]+)(?:[eE][+-]?[0-9]+)?$/;

export function parseSrcset(input) {
  // 1. Let input be the value passed to this algorithm.
  const inputLength = input.length;

  let url;
  let descriptors;
  let currentDescriptor;
  let state;
  let c;

  // 2. Let position be a pointer into input, initially pointing at the start
  //    of the string.
  let position = 0;
  let startUrlPosition;

  // eslint-disable-next-line consistent-return
  function collectCharacters(regEx) {
    let chars;
    const match = regEx.exec(input.substring(position));

    if (match) {
      [chars] = match;
      position += chars.length;

      return chars;
    }
  }

  // 3. Let candidates be an initially empty source set.
  const candidates = [];

  // 4. Splitting loop: Collect a sequence of characters that are space
  //    characters or U+002C COMMA characters. If any U+002C COMMA characters
  //    were collected, that is a parse error.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    collectCharacters(regexLeadingCommasOrSpaces);

    // 5. If position is past the end of input, return candidates and abort these steps.
    if (position >= inputLength) {
      if (candidates.length === 0) {
        throw new Error('Must contain one or more image candidate strings');
      }

      // (we're done, this is the sole return path)
      return candidates;
    }

    // 6. Collect a sequence of characters that are not space characters,
    //    and let that be url.
    startUrlPosition = position;
    url = collectCharacters(regexLeadingNotSpaces);

    // 7. Let descriptors be a new empty list.
    descriptors = [];

    // 8. If url ends with a U+002C COMMA character (,), follow these substeps:
    //		(1). Remove all trailing U+002C COMMA characters from url. If this removed
    //         more than one character, that is a parse error.
    if (url.slice(-1) === ',') {
      url = url.replace(regexTrailingCommas, '');

      // (Jump ahead to step 9 to skip tokenization and just push the candidate).
      parseDescriptors();
    }
    //	Otherwise, follow these substeps:
    else {
      tokenize();
    }

    // 16. Return to the step labeled splitting loop.
  }

  /**
   * Tokenizes descriptor properties prior to parsing
   * Returns undefined.
   */
  function tokenize() {
    // 8.1. Descriptor tokenizer: Skip whitespace
    collectCharacters(regexLeadingSpaces);

    // 8.2. Let current descriptor be the empty string.
    currentDescriptor = '';

    // 8.3. Let state be in descriptor.
    state = 'in descriptor';

    // eslint-disable-next-line no-constant-condition
    while (true) {
      // 8.4. Let c be the character at position.
      c = input.charAt(position);

      //  Do the following depending on the value of state.
      //  For the purpose of this step, "EOF" is a special character representing
      //  that position is past the end of input.

      // In descriptor
      if (state === 'in descriptor') {
        // Do the following, depending on the value of c:

        // Space character
        // If current descriptor is not empty, append current descriptor to
        // descriptors and let current descriptor be the empty string.
        // Set state to after descriptor.
        if (isASCIIWhitespace(c)) {
          if (currentDescriptor) {
            descriptors.push(currentDescriptor);
            currentDescriptor = '';
            state = 'after descriptor';
          }
        }
        // U+002C COMMA (,)
        // Advance position to the next character in input. If current descriptor
        // is not empty, append current descriptor to descriptors. Jump to the step
        // labeled descriptor parser.
        else if (c === ',') {
          position += 1;

          if (currentDescriptor) {
            descriptors.push(currentDescriptor);
          }

          parseDescriptors();

          return;
        }
        // U+0028 LEFT PARENTHESIS (()
        // Append c to current descriptor. Set state to in parens.
        else if (c === '\u0028') {
          currentDescriptor += c;
          state = 'in parens';
        }
        // EOF
        // If current descriptor is not empty, append current descriptor to
        // descriptors. Jump to the step labeled descriptor parser.
        else if (c === '') {
          if (currentDescriptor) {
            descriptors.push(currentDescriptor);
          }

          parseDescriptors();

          return;

          // Anything else
          // Append c to current descriptor.
        } else {
          currentDescriptor += c;
        }
      }
      // In parens
      else if (state === 'in parens') {
        // U+0029 RIGHT PARENTHESIS ())
        // Append c to current descriptor. Set state to in descriptor.
        if (c === ')') {
          currentDescriptor += c;
          state = 'in descriptor';
        }
        // EOF
        // Append current descriptor to descriptors. Jump to the step labeled
        // descriptor parser.
        else if (c === '') {
          descriptors.push(currentDescriptor);
          parseDescriptors();
          return;
        }
        // Anything else
        // Append c to current descriptor.
        else {
          currentDescriptor += c;
        }
      }
      // After descriptor
      else if (state === 'after descriptor') {
        // Do the following, depending on the value of c:
        if (isASCIIWhitespace(c)) {
          // Space character: Stay in this state.
        }
        // EOF: Jump to the step labeled descriptor parser.
        else if (c === '') {
          parseDescriptors();
          return;
        }
        // Anything else
        // Set state to in descriptor. Set position to the previous character in input.
        else {
          state = 'in descriptor';
          position -= 1;
        }
      }

      // Advance position to the next character in input.
      position += 1;
    }
  }

  /**
   * Adds descriptor properties to a candidate, pushes to the candidates array
   * @return undefined
   */
  // Declared outside of the while loop so that it's only created once.
  function parseDescriptors() {
    // 9. Descriptor parser: Let error be no.
    let pError = false;

    // 10. Let width be absent.
    // 11. Let density be absent.
    // 12. Let future-compat-h be absent. (We're implementing it now as h)
    let w;
    let d;
    let h;
    let i;
    const candidate = {};
    let desc;
    let lastChar;
    let value;
    let intVal;
    let floatVal;

    // 13. For each descriptor in descriptors, run the appropriate set of steps
    // from the following list:
    for (i = 0; i < descriptors.length; i++) {
      desc = descriptors[i];

      lastChar = desc[desc.length - 1];
      value = desc.substring(0, desc.length - 1);
      intVal = parseInt(value, 10);
      floatVal = parseFloat(value);

      // If the descriptor consists of a valid non-negative integer followed by
      // a U+0077 LATIN SMALL LETTER W character
      if (regexNonNegativeInteger.test(value) && lastChar === 'w') {
        // If width and density are not both absent, then let error be yes.
        if (w || d) {
          pError = true;
        }

        // Apply the rules for parsing non-negative integers to the descriptor.
        // If the result is zero, let error be yes.
        // Otherwise, let width be the result.
        if (intVal === 0) {
          pError = true;
        } else {
          w = intVal;
        }
      }
      // If the descriptor consists of a valid floating-point number followed by
      // a U+0078 LATIN SMALL LETTER X character
      else if (regexFloatingPoint.test(value) && lastChar === 'x') {
        // If width, density and future-compat-h are not all absent, then let error
        // be yes.
        if (w || d || h) {
          pError = true;
        }

        // Apply the rules for parsing floating-point number values to the descriptor.
        // If the result is less than zero, let error be yes. Otherwise, let density
        // be the result.
        if (floatVal < 0) {
          pError = true;
        } else {
          d = floatVal;
        }
      }
      // If the descriptor consists of a valid non-negative integer followed by
      // a U+0068 LATIN SMALL LETTER H character
      else if (regexNonNegativeInteger.test(value) && lastChar === 'h') {
        // If height and density are not both absent, then let error be yes.
        if (h || d) {
          pError = true;
        }

        // Apply the rules for parsing non-negative integers to the descriptor.
        // If the result is zero, let error be yes. Otherwise, let future-compat-h
        // be the result.
        if (intVal === 0) {
          pError = true;
        } else {
          h = intVal;
        }

        // Anything else, Let error be yes.
      } else {
        pError = true;
      }
    }

    // 15. If error is still no, then append a new image source to candidates whose
    // URL is url, associated with a width width if not absent and a pixel
    // density density if not absent. Otherwise, there is a parse error.
    if (!pError) {
      candidate.source = { value: url, startIndex: startUrlPosition };

      if (w) {
        candidate.width = { value: w };
      }

      if (d) {
        candidate.density = { value: d };
      }

      if (h) {
        candidate.height = { value: h };
      }

      candidates.push(candidate);
    } else {
      throw new Error(
        `Invalid srcset descriptor found in '${input}' at '${desc}'`
      );
    }
  }
}

export function parseSrc(input) {
  if (!input) {
    throw new Error('Must be non-empty');
  }

  let startIndex = 0;
  let value = input;

  while (isASCIIWhitespace(value.substring(0, 1))) {
    startIndex += 1;
    value = value.substring(1, value.length);
  }

  while (isASCIIWhitespace(value.substring(value.length - 1, value.length))) {
    value = value.substring(0, value.length - 1);
  }

  if (!value) {
    throw new Error('Must be non-empty');
  }

  return { value, startIndex };
}

export function getFilter(filter, defaultFilter = null) {
  return (attribute, value, resourcePath) => {
    if (defaultFilter && !defaultFilter(value)) {
      return false;
    }

    if (typeof filter === 'function') {
      return filter(attribute, value, resourcePath);
    }

    return true;
  };
}

export function isProductionMode(loaderContext) {
  return loaderContext.mode === 'production' || !loaderContext.mode;
}

export function getImportCode(html, importedMessages, codeOptions) {
  if (importedMessages.length === 0) {
    return '';
  }

  const { loaderContext, esModule } = codeOptions;
  const stringifiedHelperRequest = stringifyRequest(
    loaderContext,
    require.resolve('./runtime/getUrl.js')
  );

  let code = esModule
    ? `import ${GET_SOURCE_FROM_IMPORT_NAME} from ${stringifiedHelperRequest};\n`
    : `var ${GET_SOURCE_FROM_IMPORT_NAME} = require(${stringifiedHelperRequest});\n`;

  for (const item of importedMessages) {
    const { importName, source } = item;
    const stringifiedSourceRequest = stringifyRequest(loaderContext, source);

    code += esModule
      ? `import ${importName} from ${stringifiedSourceRequest};\n`
      : `var ${importName} = require(${stringifiedSourceRequest});\n`;
  }

  return `// Imports\n${code}`;
}

export function getModuleCode(html, replaceableMessages) {
  let code = JSON.stringify(html)
    // Invalid in JavaScript but valid HTML
    .replace(/[\u2028\u2029]/g, (str) =>
      str === '\u2029' ? '\\u2029' : '\\u2028'
    );

  let replacersCode = '';

  for (const item of replaceableMessages) {
    const { importName, replacerName, unquoted, hash } = item;

    const getUrlOptions = []
      .concat(hash ? [`hash: ${JSON.stringify(hash)}`] : [])
      .concat(unquoted ? 'maybeNeedQuotes: true' : []);
    const preparedOptions =
      getUrlOptions.length > 0 ? `, { ${getUrlOptions.join(', ')} }` : '';

    replacersCode += `var ${replacerName} = ${GET_SOURCE_FROM_IMPORT_NAME}(${importName}${preparedOptions});\n`;

    code = code.replace(
      new RegExp(replacerName, 'g'),
      () => `" + ${replacerName} + "`
    );
  }

  return `// Module\n${replacersCode}var code = ${code};\n`;
}

export function getExportCode(html, exportedMessages, codeOptions) {
  if (codeOptions.esModule) {
    return `// Exports\nexport default code;`;
  }

  return `// Exports\nmodule.exports = code;`;
}
