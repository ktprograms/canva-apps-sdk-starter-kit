/*
    cyrb53 (c) 2018 bryc (github.com/bryc)
    License: Public domain (or MIT if needed). Attribution appreciated.
    A fast and simple 53-bit string hash function with decent collision resistance.
    Largely inspired by MurmurHash2/3, but with a focus on speed/simplicity.
*/
const cyrb53 = function(obj: object, seed = 0): number {
  const str = JSON.stringify(obj);

  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0, ch; i < str.length; i++) {
    ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};

// For usage information, see the README.md file.
import { Button, Box, Rows, Text, Checkbox, Alert } from "@canva/app-ui-kit";
import { editContent, InlineFormatting, RichtextContentRange, RichtextContentSession } from "@canva/design";
import * as styles from "styles/components.css";
import { convertWordsToLorem } from "./lorem_generator";
import { useEffect, useState } from "react";

const enum Task {
  CHECK_SPELLING,
  WITH_FORMATTING,
  WITHOUT_FORMATTING,
  MARK,
}

export const App = () => {
  // This state controls the buttons in the app. It is used to disable them while a translation is in progress.
  const [inProgressTask, setInProgressTask] = useState<Task | undefined>(
    undefined,
  );

  const checkSpellingInner = async (session: RichtextContentSession) => {
    setInProgressTask(Task.CHECK_SPELLING);

    // Extract plaintext from each richtext element, ignoring any formatting like bold, italic, etc.
    const items = prepare(session.contents);

    const matches = await spellcheck(items);
    setMatches(matches);

    const itemsMap = itemsToMap(items);

    for (const { length, offset, textId } of matches) {
      // TEST: This shouldn't have changed from FIVE LINES AGO
      const range = itemsMap[textId]!.range;

      let start = range.readPlaintext().length;
      range.readTextRegions().reverse().forEach((region) => {
        const rLength = region.text.length;
        start -= rLength;

        const url = new URL("https://spellcheck.example.com");
        url.hash = btoa(JSON.stringify(region.formatting));

        const format: InlineFormatting = {
          color: "#ff0000",
          decoration: "underline",
          link: url.toString(),
        };

        if (offset <= start && offset + length >= start + rLength) {
          // Region fully contained in match
          range.formatText(
            { index: start, length: rLength },
            format,
          );
        } else if (offset > start && offset + length < start + rLength) {
          // Region fully encloses match
          range.formatText(
            { index: offset, length },
            format,
          );
        } else if (offset > start && offset < start + rLength) {
          // Region starts before match
          range.formatText(
            { index: offset, length: rLength - (offset - start) },
            format,
          );
        } else if (offset + length < start + rLength && offset + length > start) {
          // Region ends after match
          range.formatText(
            { index: start, length: length - (start - offset) },
            format,
          );
        }
      });

      // NOTE: ids change when highlighting
      // Fix spelling removes the highlighting, returning the ID back to original
      // FIXME: Not if a one of many errors are selected to fix within a range, and the range isn't fully returned to original
      // In that case, update IDs and then the unhighlight step can be in the same sync
    }

    await session.sync();

    setInProgressTask(undefined);
  };

  const checkSpelling = async () => {
    // Ensure running check multiple times preserves original style
    await clearFormatting();

    // Start a content editing session for all richtext elements on the current page
    await editContent(
      {
        contentType: "richtext",
        target: "current_page",
      },
      async (session) => {
        await checkSpellingInner(session);
      },
    );
    setHasChecked(true);
  };

  const clearFormatting = async () => {
    await editContent(
      {
        contentType: "richtext",
        target: "current_page",
      },
      async (session) => {
        session.contents.forEach((range) => {
          let endOfRegion = range.readPlaintext().length;

          range.readTextRegions().reverse().forEach((region) => {

            endOfRegion = endOfRegion - region.text.length;

            const rLink = region.formatting?.link;
            if (rLink) {
              try {
                const { color, fontWeight, fontStyle, decoration, strikethrough, link } = JSON.parse(atob(new URL(rLink).hash.substring(1))) as InlineFormatting;

                // Make sure not to run format on other URLs which happen to match the format
                if (
                  color !== undefined &&
                  fontWeight !== undefined &&
                  fontStyle !== undefined &&
                  decoration !== undefined &&
                  strikethrough !== undefined &&
                  link !== undefined
                ) {
                  range.formatText(
                    {
                      index: endOfRegion,
                      length: region.text.length,
                    },
                    {
                      color,
                      fontWeight,
                      fontStyle,
                      decoration,
                      strikethrough,
                      link,
                    },
                  );
                }
              } catch { }
            }
          });
        });

        await session.sync();
      }
    );
  };

  const fixWithExtendStartFormatting = async () => {
    setInProgressTask(Task.WITH_FORMATTING);
    await clearFormatting();
    await editContent(
      {
        contentType: "richtext",
        target: "current_page",
      },
      async (session) => {
        const itemsMap = prepareMap(session.contents);

        if (matches.filter(({ textId }) => itemsMap[textId] !== undefined).length !== matches.length) {
          setOutdated(true);
          await checkSpellingInner(session);
          return;
        }

        for (const { length, offset, replacements, textId } of matches) {
          const range = itemsMap[textId]!.range;

          range.replaceText({ index: offset, length }, replacements[0]!.value);
        }

        await session.sync();

        setMatches([]); // FIXME: Filter for fixes to implement (not ignored);
        setOutdated(false);

        // Run spellcheck again to find any errors previously missed
        // TEST: See whether needed once the text/allbuttext calls are added
        await checkSpellingInner(session);
      }
    );
    setInProgressTask(undefined);
  };

  /**
   * Translates the text in the page while respecting inline formatting.
   * If this looks too complicated, look to the `translateWithoutFormatting` method above to help learn the basics.
   */
  const translateWithFormatting = async () => {
    setInProgressTask(Task.WITH_FORMATTING);
    // Start a content editing session for all richtext elements on the current page
    await editContent(
      {
        contentType: "richtext",
        target: "current_page",
      },
      async (session) => {
        // Extract text regions which preserve formatting boundaries (bold, italic, etc.)
        const request = session.contents.map((range) =>
          range.readTextRegions().map((region) => region.text),
        );

        // Simulate a translation API call (in production, this would call a real translation service)
        const response = await getTranslation(request);

        // Apply translations to each richtext element while preserving formatting
        session.contents.forEach((range, index) => {
          // Get the translated regions corresponding to this text element
          const translatedRegions = response[index];
          // Track position from the end of the text to avoid index recalculation during replacement
          let endOfRegion = range.readPlaintext().length;
          // Get all text regions with their formatting information
          const regionsToTranslate = range.readTextRegions();
          // Process regions in reverse order to avoid position shifts affecting subsequent replacements
          regionsToTranslate.reverse().forEach((region, i) => {
            // Calculate the start position of the current region
            endOfRegion = endOfRegion - region.text.length;
            // Replace the current region (starting at the end of the previous region with length equal to the length of the text in the region)
            // with the translated text.
            const translatedText =
              translatedRegions?.[regionsToTranslate.length - 1 - i];
            if (translatedText) {
              range.replaceText(
                {
                  index: endOfRegion,
                  length: region.text.length,
                },
                translatedText,
              );
            }
          });
        });

        // Commit all changes to the design - this makes the changes visible to the user
        await session.sync();
      },
    );
    setInProgressTask(undefined);
  };

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        // TODO: Enable
        // await checkSpelling();
      } catch (error) {
        console.error(error);
      }
    }, 60 * 1000); // FIXME: Set (keep in mind rate limit)

    return () => clearInterval(interval);
  }, []);

  const [hasChecked, setHasChecked] = useState(false);

  const [matches, setMatches] = useState<LanguageToolMatches>([]);
  const [outdated, setOutdated] = useState(false);

  return (
    <div className={styles.scrollContainer}>
      <Rows spacing="2u">
        {outdated && <Alert tone="critical">
          Content has changed since the last spellcheck.
          Please review the new results and press "Fix" again.
        </Alert>}
        {/*<Text>
          This example demonstrates how apps can translate all text in the
          current page
        </Text>
        <Button
          variant="secondary"
          onClick={translateWithFormatting}
          disabled={inProgressTask != null}
          loading={inProgressTask === Task.WITH_FORMATTING}
        >
          Translate with formatting
        </Button>*/}
        <Button
          variant="secondary"
          onClick={checkSpelling}
          disabled={inProgressTask != null}
          loading={inProgressTask === Task.CHECK_SPELLING}
        >
          {/* NOTE: And grammar */}
          Check spelling
        </Button>

        {hasChecked && (
          matches.length == 0 && inProgressTask == null
            ? <Alert tone="positive">No mistakes found!</Alert>
            : <Suggestions matches={matches} />
        )}

        <Button
          variant="primary"
          onClick={fixWithExtendStartFormatting}
          disabled={inProgressTask != null || matches.length == 0}
          loading={inProgressTask === Task.WITHOUT_FORMATTING}
        >
          Fix
        </Button>
      </Rows>
    </div>
  );
};

export const Suggestions = (props: { matches: LanguageToolMatches }) => (
  <Rows spacing="1u">
    <Text variant="bold">
      {/* TODO: https://formatjs.github.io/docs/react-intl/components/#formattedplural */}
      Suggestions ({props.matches.length})
    </Text>
    <Box
      background="neutralLow"
      borderRadius="large"
      padding="1u"
    >
      <Checkbox
        label="Select all"
        defaultChecked={true}
      />
    </Box>
    {props.matches.map((match) => {
      const { replacements, original } = match;

      // FIXME: Range errors
      const replacement = replacements[0]!.value;

      return (
        <Box
          background="neutralLow"
          borderRadius="large"
          padding="1u"
          key={cyrb53(match)}
        >
          <Checkbox
            label={
              <Text>
                <span style={{ color: "red", fontWeight: "bold" }}>{original}</span>
                <span> ➙ </span>
                <span style={{ color: "green" }}>{replacement}</span>
              </Text>
            }
            defaultChecked={true}
          />
        </Box>
      );
    })}
  </Rows >
);

/**
 * Mock function that simulates calling an external translation API.
 * In a production app, this would make HTTP requests to services like Google Translate,
 * AWS Translate, or Azure Translator Text.
 * @param text Array of text chunks to translate, grouped by richtext element
 * @returns Promise resolving to translated text chunks in the same structure
 */
async function getTranslation(text: string[][]): Promise<string[][]> {
  // Simulate network delay that would occur with a real translation API
  await new Promise((res) => setTimeout(res, 500));
  // Convert to lorem ipsum as a placeholder for actual translation
  return text.map((t) => convertWordsToLorem(t));
}

type LanguageToolParams = {
  text: string;
  language: "auto" | string;
}

type LanguageToolResponse = {
  matches: {
    length: number;
    offset: number;

    type: {
      // https://github.com/languagetool-org/languagetool/blob/bd0b8ccdedbe426094049e2ccda5230ce36fc4c4/languagetool-core/src/main/proto/result_cache.proto#L17-L24
      typeName: "UnknownWord" | "Hint" | "Other";
    };

    replacements: {
      value: string;
    }[];
  }[];
}
type LanguageToolMatches = (LanguageToolResponse['matches'][0] & {
  textId: number;
  original: string;

  // TODO: Add "ignored" for checkbox (optional)
})[]

type Item = {
  id: number;
  plaintext: string;
  range: RichtextContentRange;
}

function prepare(contents: readonly RichtextContentRange[]): Item[] {
  return contents.map((range) => {
    const richtext = range.readTextRegions();

    return {
      id: cyrb53(richtext), // FIXME: Same text+formatting leads to same (if from Duplicate)
      plaintext: range.readPlaintext(),
      range,
    };
  });
}

type ItemMap = {
  [id: number]: Item;
};

function itemsToMap(items: Item[]): ItemMap {
  return items.reduce<ItemMap>((acc, item) => {
    acc[item.id] = item;
    return acc;
  }, {});
}

function prepareMap(content: readonly RichtextContentRange[]): ItemMap {
  return itemsToMap(prepare(content));
}

// FIXME: (proj): Handle deleted ranges
// FIXME: (proj): Handle substring OOBE
// FIXME: (proj): Lists (and not creating list in multiline text)
// FIXME: (proj): No replacement available
// FIXME (proj): Top level error handling
// NOTE: (proj): Can check HIDDEN rules (check LT premium for example and API response) and implement when found

// FIXME: (lt): Many adjectives read as nouns (e.g. brilliant) https://github.com/languagetool-org/languagetool/blob/72b75d98aef09185b727a9a82cbcf9d934017ef7/languagetool-language-modules/en/src/main/resources/org/languagetool/resource/en/disambiguation.xml#L2850 DT_JJNN_IN_NN being taken wrongly?

type TextItem = {
  text: string;
  range: {
    offset: number;
    length: number;
  };

  id: number;
  plaintext: string;

  plaintextStart: number;
}

// FIXME: Error handling
// TODO: Allow picking other replacements
async function spellcheck(items: Item[]): Promise<LanguageToolMatches> {
  const textItems = items.reduce<TextItem[]>((acc, item) => {
    const { id, plaintext } = item;

    const header = `\n${id}\n\n`

    const text = `${header}${plaintext}`;
    const length = text.length;

    let offset = 0;
    const last = acc.at(-1);
    if (last) {
      offset = last.range.offset + last.range.length;
    }

    return [...acc, {
      text,
      range: {
        offset,
        length,
      },

      id,
      plaintext,

      plaintextStart: header.length,
    } as TextItem];
  }, []);

  const text: string = textItems.map(({ text }) => text).join("");

  const request = new Request("https://api.languagetool.org/v2/check", {
    method: "POST",
    body: new URLSearchParams({
      text,
      language: "auto",
      enableHiddenRules: true,
      level: "picky",
      noopLanguages: "en",
      preferredVariants: "en-US,de-DE,pt-BR,ca-es", // FIXME: Locale
      abtest: "deggec,esggec,ptggec,qb,gc_1_aggressive,de_gc_1_aggressive,fr_gc_1_aggressive,pt_gc_1_aggressive,nl_gc_1_aggressive,es_gc_1_aggressive",
      preferredLanguages: "en",
      disabledRules: "WHITESPACE_RULE",
      useragent: "standalone",
      // FIXME: Also run textLevelOnly and combine
      mode: "allButTextLevelOnly",
      allowIncompleteResults: true,
    } as LanguageToolParams),
  });

  // FIXME: <token regexp="yes">important|significant</token>
  // NOTE: QB (AI-based) rules for en-US on languagetool.org

  const data = await (await fetch(request)).text();
  const response = JSON.parse(data) as LanguageToolResponse;

  // FIXME:
  response.matches = response.matches.filter(({ type: { typeName: type }, replacements }) => type !== "Hint" && replacements.length > 0);

  // DEBUG
  console.debug(text, textItems);
  console.debug(data);
  response.matches.forEach((match) => {
    const { offset, length, replacements, type: { typeName: type } } = match;
    console.debug(`${type}@${offset}+${length}=${text.substring(offset, offset + length)} -> ${replacements[0]!.value}`);
  });
  // END DEBUG

  // NOTE: Fix spelling depends on this being reverse sorted
  response.matches.sort(({ offset: a }, { offset: b }) => b - a);

  return response.matches.flatMap(({ length, offset, type, replacements }) => {
    const textItem = textItems.find(({ range: { offset: rOffset, length: rLength } }) => {
      return rOffset <= offset && (rOffset + rLength) >= offset + length;
    })!;

    if (!textItem) {
      // FIXME:
      return [];
    }

    const { range: { offset: rOffset }, id, plaintext, plaintextStart } = textItem;

    offset -= rOffset + plaintextStart;

    if (offset < 0 || replacements.length == 0) {
      return [];
    }

    return [{
      textId: id,
      length,
      offset,
      type,
      replacements,
      original: plaintext.substring(offset, offset + length),
    }];
  });

  // const result = response.matches.reduce((acc, { offset, length, replacements }) => (
  //   acc.substring(0, offset) + replacements[0]!.value + acc.substring(offset + length)
  // ), text);
  // console.log(result)
  //
  // return Promise.resolve([result]);
}
