const AUTO_CHECK_INTERVAL = 30 * 1000; // 30 seconds

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
import { Button, Box, Rows, Text, Checkbox, Alert, EyeIcon } from "@canva/app-ui-kit";
import { editContent, InlineFormatting, RichtextContentRange, RichtextContentSession } from "@canva/design";
import * as styles from "styles/components.css";
import { Dispatch, useEffect, useState } from "react";

const enum Task {
  CHECK_SPELLING,
  FIX,
  FOCUS_MATCH,
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
    try {
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
    } catch (error) {
      console.error(error);
    }
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

  const clearResults = async () => {
    try {
      await clearFormatting();
      setHasChecked(false);
      setMatches([]);
    } catch (error) {
      console.error(error);
    }
  };

  const fixWithExtendStartFormatting = async () => {
    try {
      setInProgressTask(Task.FIX);
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
          await checkSpellingInner(session);
        }
      );
      setInProgressTask(undefined);
    } catch (error) {
      console.error(error);
    }
  };

  // FIXME: Uses prepareMap with highlighted results IDs but match has original ID
  const focusOnMatch = async (focusedMatch: LanguageToolMatches[0]) => {
    try {
      setInProgressTask(Task.FOCUS_MATCH);
      await editContent(
        {
          contentType: "richtext",
          target: "current_page",
        },
        async (session) => {
          const itemsMap = prepareMap(session.contents);

          const item = itemsMap[focusedMatch.textId];
          if (!item) {
            return;
          }

          const range = item.range;

          range.formatText(
            { index: focusedMatch.offset, length: focusedMatch.length },
            { color: '#663399' },
          );

          await session.sync();
        },
      );
      setInProgressTask(undefined);
    } catch (error) {
      console.error(error);
    }
  };

  useEffect(() => {
    const interval = setInterval(async () => {
      await checkSpelling();
    }, AUTO_CHECK_INTERVAL);

    return () => clearInterval(interval);
  }, []);

  const [hasChecked, setHasChecked] = useState(false);

  const [matches, setMatches] = useState<LanguageToolMatches>([]);
  const [outdated, setOutdated] = useState(false);

  const [focusedMatch, setFocusedMatch] = useState<LanguageToolMatches[0] | undefined>();

  useEffect(() => {
    (async () => {
      if (focusedMatch) {
        await focusOnMatch(focusedMatch);
      }
    })();
  }, [focusedMatch])
  // FIXME: Clear focused match (UI and also on new check spelling)

  return (
    <div className={styles.scrollContainer}>
      <Rows spacing="2u">
        {outdated && <Alert tone="critical">
          Content has changed since the last spellcheck.
          Please review the new results and press "Fix" again.
        </Alert>}

        <Button
          variant="secondary"
          onClick={checkSpelling}
          disabled={inProgressTask != null}
          loading={inProgressTask === Task.CHECK_SPELLING}
        >
          Check
        </Button>

        {hasChecked && (
          matches.length == 0 && inProgressTask == null
            ? <Alert tone="positive">No mistakes found!</Alert>
            : <Suggestions matches={matches} setFocusedMatch={setFocusedMatch} inProgressTask={inProgressTask} />
        )}

        <Rows spacing="1u">
          <Button
            variant="primary"
            onClick={fixWithExtendStartFormatting}
            disabled={inProgressTask != null || matches.length == 0}
            loading={inProgressTask === Task.FIX}
          >
            Fix
          </Button>

          {matches.length > 0 && (
            <Button
              variant="secondary"
              onClick={clearResults}
              disabled={inProgressTask != null}
            >
              Clear results
            </Button>
          )}
        </Rows>
      </Rows>
    </div>
  );
};

export const Suggestions = (props: {
  matches: LanguageToolMatches;
  setFocusedMatch: Dispatch<LanguageToolMatches[0] | undefined>;
  inProgressTask: Task | undefined;
}) => (
  <Rows spacing="1u">
    <Text variant="bold">
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
      const { textId, replacements, original } = match;

      const replacement = replacements[0]!.value;

      return (
        <Box
          background="neutralLow"
          borderRadius="large"
          padding="1u"
          key={textId}
        >
          <Box display="inline-flex" alignItems="center" justifyContent="spaceBetween" width="full">
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

            <Button
              icon={EyeIcon}
              size="small"
              variant="tertiary"
              onClick={() => props.setFocusedMatch(match)}
              disabled={props.inProgressTask != null}
            />
          </Box>
        </Box>
      );
    })}
  </Rows >
);

type LanguageToolParams = {
  text: string;
  language: "auto" | string;

  [key: string]: any;
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

// FIXME: (proj): Ignore and keep ignored based on context+original+replacement (e.g. on résumé page 2)
// NOTE: (proj): QB messes up Lists (and not creating list in multiline text), should be fine with self-hosted or other locale
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
  const preferredVariants = navigator.languages.filter((locale) => new Intl.Locale(locale).region !== undefined).join();
  const baseParams: LanguageToolParams = {
    text,
    language: "auto",
    enableHiddenRules: true,
    level: "picky",
    noopLanguages: "en",
    ...(preferredVariants !== "") && { preferredVariants },
    abtest: "deggec,esggec,ptggec,qb,gc_1_aggressive,de_gc_1_aggressive,fr_gc_1_aggressive,pt_gc_1_aggressive,nl_gc_1_aggressive,es_gc_1_aggressive",
    preferredLanguages: "en",
    disabledRules: "WHITESPACE_RULE",
    useragent: "standalone",
  }

  let matches: LanguageToolResponse["matches"] = []

  const abtloRequest = new Request("https://api.languagetool.org/v2/check", {
    method: "POST",
    body: new URLSearchParams({
      ...baseParams,
      mode: "allButTextLevelOnly",
      allowIncompleteResults: true,
    } as LanguageToolParams),
  });
  const abtloData = await (await fetch(abtloRequest)).text();
  const abtloResponse = JSON.parse(abtloData) as LanguageToolResponse;
  matches.push(...abtloResponse.matches);

  const tloRequest = new Request("https://api.languagetool.org/v2/check", {
    method: "POST",
    body: new URLSearchParams({
      ...baseParams,
      mode: "textLevelOnly",
    } as LanguageToolParams),
  });
  const tloData = await (await fetch(tloRequest)).text();
  const tloResponse = JSON.parse(tloData) as LanguageToolResponse;
  matches.push(...tloResponse.matches);

  // FIXME: (lt): <token regexp="yes">important|significant</token>
  // NOTE: (lt):QB (AI-based) rules for en-US on languagetool.org
  // FIXME: (lt): 2022 - Present en-dash

  // FIXME: If no replacement, still show but don't attempt to fix?
  matches = matches.filter(({ type: { typeName: type }, replacements }) => type !== "Hint" && replacements.length > 0);

  // DEBUG
  console.debug(text, textItems);
  console.debug(abtloData, tloData);
  matches.forEach((match) => {
    const { offset, length, replacements, type: { typeName: type } } = match;
    console.debug(`${type}@${offset}+${length}=${text.substring(offset, offset + length)} -> ${replacements[0]!.value}`);
  });
  // END DEBUG

  // Fix spelling depends on this being reverse sorted
  matches.sort(({ offset: a }, { offset: b }) => b - a);

  return matches.flatMap(({ length, offset, type, replacements }) => {
    const textItem = textItems.find(({ range: { offset: rOffset, length: rLength } }) => {
      return rOffset <= offset && (rOffset + rLength) >= offset + length;
    })!;

    if (!textItem) {
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
}
