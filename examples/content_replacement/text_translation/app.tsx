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
import { Button, Box, Rows, Text, Checkbox } from "@canva/app-ui-kit";
import { editContent, InlineFormatting, RichtextContentRange, TextRegion } from "@canva/design";
import * as styles from "styles/components.css";
import { convertWordsToLorem } from "./lorem_generator";
import { Dispatch, SetStateAction, useEffect, useState } from "react";
import { TextInput } from "node_modules/@canva/app-ui-kit/dist/cjs/ui/apps/developing/ui_kit/entry";

// FIXME: Hash content to add ID to unordered array

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
  /**
   * Translates the text on the page while ignoring any inline formatting.
   * This implementation provides a simpler approach, making it an ideal starting point
   * for understanding the basics of text editing functionality.
   */
  const checkSpelling = async () => {
    setInProgressTask(Task.CHECK_SPELLING);
    // Start a content editing session for all richtext elements on the current page
    await editContent(
      {
        contentType: "richtext",
        target: "current_page",
      },
      async (session) => {
        // Extract plaintext from each richtext element, ignoring any formatting like bold, italic, etc.
        const items = prepare(session.contents);
        console.log(items);

        setMatches(await spellcheck(items));

        // const itemsMap = itemsToMap(items);
        //
        // for (const { length, offset, textId } of matches) {
        //   // TEST: This shouldn't have changed from FIVE LINES AGO
        //   const range = itemsMap[textId]!.range;
        //
        //   let start = range.readPlaintext().length;
        //   range.readTextRegions().reverse().forEach((region) => {
        //     const rLength = region.text.length;
        //     start -= rLength;
        //
        //     const url = new URL("https://spellcheck.example.com");
        //     url.hash = btoa(JSON.stringify(region.formatting));
        //
        //     const format: InlineFormatting = {
        //       color: "#ff0000",
        //       decoration: "underline",
        //       link: url.toString(),
        //     };
        //
        //     console.log(region.text, offset, length, start, rLength);
        //
        //     if (offset <= start && offset + length >= start + rLength) {
        //       // Region fully contained in match
        //       console.log('A');
        //       range.formatText(
        //         { index: start, length: rLength },
        //         format,
        //       );
        //     } else if (offset > start && offset + length < start + rLength) {
        //       // Region fully encloses match
        //       console.log('B');
        //       range.formatText(
        //         { index: offset, length },
        //         format,
        //       );
        //     } else if (offset > start && offset < rLength) {
        //       // Region starts before match
        //       console.log('C');
        //       range.formatText(
        //         { index: offset, length: (start + rLength) - (offset - start) },
        //         format,
        //       );
        //     } else {
        //       // Region ends after match
        //       console.log('D');
        //       range.formatText(
        //         { index: start, length: length - (start - offset) },
        //         format,
        //       );
        //     }
        //   });

        // FIXME: ids change when highlighting
        // Update matches with new ids
        // }

        await session.sync();
      },
    );
    setInProgressTask(undefined);
  };

  const fixWithoutFormatting = async () => {
    setInProgressTask(Task.WITH_FORMATTING);
    await editContent(
      {
        contentType: "richtext",
        target: "current_page",
      },
      async (session) => {
        const itemsMap = prepareMap(session.contents);

        for (const { length, offset, replacements, textId } of matches) {
          // FIXME: This is undefined if textId changed (edited)
          // Prompt/do spellcheck again (can just call spellcheck here, no need checkSpelling)
          // Make replaceText idempotent (redo this session function if spellcheck again)
          const range = itemsMap[textId]!.range;

          range.replaceText({ index: offset, length }, replacements[0]!.value);
        }

        await session.sync();

        setMatches([]); // FIXME: Filter for implemented fixes (not ignored);
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

  const mark = async () => {
    setInProgressTask(Task.MARK);
    // Start a content editing session for all richtext elements on the current page
    // FIXME: Handle rate_limited error
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
        const response = request;

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
              let formatting: InlineFormatting = {};

              const link = region.formatting?.link;
              if (link) {
                try {
                  const data = JSON.parse(atob(new URL(link).hash.substring(1)));

                  for (const k of ['color', 'fontWeight', 'fontStyle', 'decoration', 'strikethrough', 'link'] as (keyof InlineFormatting)[]) {
                    if (k in data) {
                      formatting[k] = (data as any)[k];
                    }
                  }
                } catch { }
              }

              const url = new URL("https://spellcheck.example.com");
              url.hash = btoa(JSON.stringify(region.formatting));

              formatting = Math.random() > 0.3 ? formatting : {
                ...formatting,
                color: "#FF0000",
                decoration: "underline",
                link: url.toString(),
              }

              range.replaceText(
                {
                  index: endOfRegion,
                  length: region.text.length,
                },
                translatedText,
                formatting,
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
        await checkSpelling();
      } catch (error) {
        console.error(error);
      }
    }, 60 * 1000); // FIXME: Set (keep in mind rate limit)

    return () => clearInterval(interval);
  }, []);

  const [matches, setMatches] = useState<LanguageToolMatches>([]);

  return (
    <div className={styles.scrollContainer}>
      <Rows spacing="2u">
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
          Spellcheck
        </Button>

        <Suggestions matches={matches} />

        <Button
          variant="primary"
          onClick={fixWithoutFormatting}
          disabled={inProgressTask != null}
          loading={inProgressTask === Task.WITHOUT_FORMATTING}
        >
          Fix (without formatting)
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
      id: cyrb53(richtext),
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

    const header = `\n\n╳${id}╳\n\n`

    const text = `${header}${plaintext}`;
    const length = text.length;

    let offset = 0;
    const last = acc.at(-1);
    if (last) {
      offset = last.global.offset + last.global.length;
    }

    return [...acc, {
      text,
      global: {
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
      text: text,
      language: "auto",
      abtest: "gc_1_aggressive",
      useragent: "standalone",
    } as LanguageToolParams),
  });

  const data = await (await fetch(request)).text();
  const response = JSON.parse(data) as LanguageToolResponse;

  // DEBUG
  console.debug(text, textItems);
  console.debug(data);
  response.matches.forEach((match) => {
    const { offset, length, replacements } = match;
    console.debug(`@${offset}+${length}=${text.substring(offset, offset + length)} -> ${replacements[0]!.value}`);
  });
  // END DEBUG

  // NOTE: Fix spelling depends on this being reverse sorted
  response.matches.sort(({ offset: a }, { offset: b }) => b - a);

  return response.matches.map(({ length, offset, replacements }) => {
    const textItem = textItems.find(({ range: { offset: rOffset, length: rLength } }) => {
      return rOffset <= offset && (rOffset + rLength) >= offset + length;
    })!;

    const { range: { offset: rOffset }, id, plaintext, plaintextStart } = textItem;

    offset -= rOffset + plaintextStart;

    return {
      textId: id,
      offset,
      length,
      replacements,
      original: plaintext.substring(offset, offset + length),
    }
  });

  // const result = response.matches.reduce((acc, { offset, length, replacements }) => (
  //   acc.substring(0, offset) + replacements[0]!.value + acc.substring(offset + length)
  // ), text);
  // console.log(result)
  //
  // return Promise.resolve([result]);
}
