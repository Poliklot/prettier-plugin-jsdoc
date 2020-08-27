import commentParser from "comment-parser";
import { format, Options } from "prettier";
import { convertToModernArray, formatType } from "./type";
import { DESCRIPTION, EXAMPLE, MEMBEROF, SEE, TODO } from "./tags";
import {
  TAGS_DESCRIPTION_NEEDED,
  TAGS_NEED_FORMAT_DESCRIPTION,
  TAGS_NAMELESS,
  TAGS_SYNONYMS,
  TAGS_VERTICALLY_ALIGN_ABLE,
} from "./roles";

type JsdocOptions = {
  jsdocSpaces: number;
  jsdocDescriptionWithDot: boolean;
  jsdocDescriptionTag: boolean;
  jsdocVerticalAlignment: boolean;
  jsdocKeepUnParseAbleExampleIndent: boolean;
  jsdocTagsOrder: string[];
} & Options;
type LocationDetails = { line: number; column: number };
type Location = { start: LocationDetails; end: LocationDetails };

type PrettierComment = {
  type: "CommentBlock";
  value: string;
  start: number;
  end: number;
  loc: Location;
};
type AST = {
  start: number;
  end: number;
  loc: Location;
  errors: [];
  program: {
    type: "Program";
    start: number;
    end: number;
    loc: [];
    sourceType: "module";
    interpreter: null;
    body: [];
    directives: [];
  };
  comments: PrettierComment[];
};

const EMPTY_LINE_SIGNATURE = "#2@1093NmY^5!~#sdEKHuhPOK*&^%$";

/**
 * @link https://prettier.io/docs/en/api.html#custom-parser-api}
 */
export function jsdocParser(
  text: string,
  parsers: { [x: string]: (arg0: string) => AST },
  options: JsdocOptions
) {
  const babelTs = parsers["babel-ts"];
  const ast = babelTs(text);
  // Options
  const gap = " ".repeat(options.jsdocSpaces);
  const { printWidth = 80 } = options;

  /**
   * Control order of tags by weights. Smaller value brings tag higher.
   *
   * @param {String} tagTitle TODO
   * @returns {Number} Tag weight
   */
  function getTagOrderWeight(tagTitle: string): number {
    if (tagTitle === DESCRIPTION && !options.jsdocDescriptionTag) {
      return -1;
    }
    const index = options.jsdocTagsOrder.indexOf(tagTitle);
    return index === -1
      ? options.jsdocTagsOrder.indexOf("other") || options.jsdocTagsOrder.length
      : index;
  }

  ast.comments.forEach((comment) => {
    const {
      loc: {
        start: { column },
      },
    } = comment;

    // Parse only comment blocks
    if (comment.type !== "CommentBlock") return;

    const commentString = `/*${comment.value}*/`;

    // Check if this comment block is a JSDoc.  Based on:
    // https://github.com/jsdoc/jsdoc/blob/master/packages/jsdoc/plugins/commentsOnly.js
    if (!commentString.match(/\/\*\*[\s\S]+?\*\//g)) return;

    const parsed = commentParser(commentString, { dotted_names: false })[0];

    comment.value = "";

    convertCommentDescToDescTag(parsed);

    let maxTagTitleLength = 0;
    let maxTagTypeNameLength = 0;
    let maxTagNameLength = 0;

    parsed.tags

      // Prepare tags data
      .map(
        ({
          name,
          description,
          type,
          tag,
          source,
          optional,
          default: _default,
          ...restInfo
        }) => {
          tag = tag && tag.trim().toLowerCase();
          //@ts-ignore
          tag = TAGS_SYNONYMS[tag] || tag;
          const isVerticallyAlignAbleTags = TAGS_VERTICALLY_ALIGN_ABLE.includes(
            tag
          );

          if (TAGS_NAMELESS.includes(tag) && name) {
            description = `${name} ${description}`;
            name = "";
          }

          if (type) {
            type = convertToModernArray(type);
            type = formatType(type, options);

            if (isVerticallyAlignAbleTags)
              maxTagTypeNameLength = Math.max(
                maxTagTypeNameLength,
                type.length
              );

            // Additional operations on name
            if (name) {
              // Optional tag name
              if (optional) {
                // Figure out if tag type have default value
                if (_default) {
                  description += ` Default is \`${_default}\``;
                }
                name = `[${name}]`;
              }

              if (isVerticallyAlignAbleTags)
                maxTagNameLength = Math.max(maxTagNameLength, name.length);
            }
          }

          if (isVerticallyAlignAbleTags) {
            maxTagTitleLength = Math.max(maxTagTitleLength, tag.length);
          }

          if (TAGS_NEED_FORMAT_DESCRIPTION.includes(tag)) {
            description = formatDescription(
              description,
              options.jsdocDescriptionWithDot
            );
          }
          return {
            ...restInfo,
            name,
            description,
            type,
            tag,
            source,
            default: _default,
            optional,
          };
        }
      )

      // Sort tags
      .sort((a, b) => getTagOrderWeight(a.tag) - getTagOrderWeight(b.tag))
      .filter(({ description, tag }) => {
        if (!description && TAGS_DESCRIPTION_NEEDED.includes(tag)) {
          return false;
        }
        return true;
      })
      // Create final jsDoc string
      .forEach(({ name, description, type, tag }, tagIndex, finalTagsArray) => {
        let tagTitleGapAdj = 0;
        let tagTypeGapAdj = 0;
        let tagNameGapAdj = 0;
        let descGapAdj = 0;

        if (
          options.jsdocVerticalAlignment &&
          TAGS_VERTICALLY_ALIGN_ABLE.includes(tag)
        ) {
          if (tag) tagTitleGapAdj += maxTagTitleLength - tag.length;
          else if (maxTagTitleLength)
            descGapAdj += maxTagTitleLength + gap.length;

          if (type) tagTypeGapAdj += maxTagTypeNameLength - type.length;
          else if (maxTagTypeNameLength)
            descGapAdj += maxTagTypeNameLength + gap.length;

          if (name) tagNameGapAdj += maxTagNameLength - name.length;
          else if (maxTagNameLength) descGapAdj = maxTagNameLength + gap.length;
        }

        let useTagTitle = tag !== DESCRIPTION || options.jsdocDescriptionTag;
        let tagString = "\n";

        if (useTagTitle) {
          try {
            tagString += `@${tag}${" ".repeat(tagTitleGapAdj)}`;
          } catch (error) {
            console.log(error);
          }
        }
        if (type) {
          tagString += gap + `{${type}}` + " ".repeat(tagTypeGapAdj);
        }
        if (name) tagString += `${gap}${name}${" ".repeat(tagNameGapAdj)}`;

        // Add description (complicated because of text wrap)
        if (description && tag !== EXAMPLE) {
          if (useTagTitle) tagString += gap + " ".repeat(descGapAdj);
          if ([MEMBEROF, SEE].includes(tag)) {
            // Avoid wrapping
            tagString += description;
          } else {
            // Wrap tag description
            const beginningSpace = tag === DESCRIPTION ? "" : "    "; // google style guide space
            const marginLength = tagString.length;
            let maxWidth = printWidth - column - 3; // column is location of comment, 3 is ` * `

            if (marginLength >= maxWidth) {
              maxWidth = marginLength;
            }

            let resolveDescription = `${tagString}${description}`;

            tagString = resolveDescription
              .split(EMPTY_LINE_SIGNATURE)
              .map((paragraph) => {
                let result = "";
                while (paragraph.length > maxWidth) {
                  let sliceIndex = paragraph.lastIndexOf(" ", maxWidth);
                  if (sliceIndex === -1) sliceIndex = maxWidth;
                  result += paragraph.substring(0, sliceIndex);
                  paragraph = paragraph.substring(sliceIndex + 1);
                  paragraph = `\n${beginningSpace}${paragraph}`;
                }
                result += paragraph;

                return result;
              })
              .join("\n\n");
          }
        }

        // Try to use prettier on @example tag description
        if (tag === EXAMPLE) {
          try {
            const formattedExample = format(description || "", options);
            tagString += formattedExample.replace(/(^|\n)/g, "\n  ");
            tagString = tagString.slice(0, tagString.length - 3);
          } catch (err) {
            tagString += "\n";
            tagString += description
              .split("\n")
              .map(
                (l) =>
                  `  ${
                    options.jsdocKeepUnParseAbleExampleIndent ? l : l.trim()
                  }`
              )
              .join("\n");
          }
        }

        // Add empty line after some tags if there is something below
        tagString += descriptionEndLine({
          description: tagString,
          tag,
          isEndTag: tagIndex === finalTagsArray.length - 1,
        });

        comment.value += tagString;
      });

    comment.value = addStarsToTheBeginningOfTheLines(comment.value);
  });

  return ast;
}

/**
 * Trim, make single line with capitalized text. Insert dot if flag for it is
 * set to true and last character is a word character
 *
 * @private
 * @param {Boolean} insertDot Flag for dot at the end of text
 */
function formatDescription(text: string, insertDot: boolean): string {
  text = text || "";
  text = text.replace(/^[\W]/g, "");
  text = text.trim();

  if (!text) return text;

  text = text.replace(/\n\n/g, EMPTY_LINE_SIGNATURE); // Add a signature for empty line and use that later
  text = text.replace(/\s\s+/g, " "); // Avoid multiple spaces
  text = text.replace(/\n/g, " "); // Make single line

  if (insertDot) text = text.replace(/(\w)(?=$)/g, "$1."); // Insert dot if needed
  text = text[0].toUpperCase() + text.slice(1); // Capitalize
  return text || "";
}

function convertCommentDescToDescTag(parsed: commentParser.Comment) {
  if (!parsed.description) {
    return;
  }

  const Tag = parsed.tags.find(({ tag }) => tag.toLowerCase() === DESCRIPTION);
  let { description = "" } = Tag || {};

  description += parsed.description;

  if (Tag) {
    Tag.description = description;
  } else {
    parsed.tags.push({ tag: DESCRIPTION, description } as any);
  }
}

function descriptionEndLine({ description, tag, isEndTag }: any) {
  if (description.length < 0 || isEndTag) {
    return "";
  }

  if ([DESCRIPTION, EXAMPLE, TODO].includes(tag)) {
    return "\n";
  }

  return "";
}

function addStarsToTheBeginningOfTheLines(comment: string) {
  if (numberOfAStringInString(comment, "\n") <= 1) {
    return `* ${comment.replace(/(\n)/g, "")} `;
  }

  return `*${comment.replace(/((?!\n$)\n)/g, "\n * ")}\n `;
}

function numberOfAStringInString(string: string, search: string | RegExp) {
  return (string.match(new RegExp(search, "g")) || []).length;
}