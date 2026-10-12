const AUTO_CHECK_INTERVAL = 30 * 1000; // 30 seconds
const ERROR_COLOUR = "#ff0000";
const FOCUS_COLOUR = "#663399";

/*
    cyrb53 (c) 2018 bryc (github.com/bryc)
    License: Public domain (or MIT if needed). Attribution appreciated.
    A fast and simple 53-bit string hash function with decent collision resistance.
    Largely inspired by MurmurHash2/3, but with a focus on speed/simplicity.
*/
// Object key order may change across JSON.stringify calls.
// When consistency is required, use a stable method such as string formatting.
const cyrb53 = function(obj: any, seed = 0): number {
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
import { Dispatch, SetStateAction, useEffect, useState } from "react";

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

    const [matches, disabled] = await spellcheck(items);
    setMatches(matches);
    setDisabledMatches((prev) => {
      disabled.forEach((matchIgnore) => {
        const id = ignoreID(matchIgnore);
        prev.set(id, matchIgnore);
      });
      return prev;
    });

    const itemsMap = itemsToMap(items);

    for (const match of matches) {
      if (disabledMatches.has(ignoreID(matchAsIgnore(match)))) {
        continue;
      }

      const { length, offset, textId } = match;

      // TEST: This shouldn't have changed from FIVE LINES AGO
      const range = itemsMap.get(textId)!.range;

      let start = range.readPlaintext().length;
      // PERF: Can stop after passing the match
      range.readTextRegions().reverse().forEach((region) => {
        const rLength = region.text.length;
        start -= rLength;

        const url = new URL("https://spellcheck.example.com");
        url.hash = btoa(JSON.stringify(region.formatting));

        const format: InlineFormatting = {
          color: ERROR_COLOUR,
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
      // Check is run after every Fix (with no highlighting), so matches are always valid and not stale
    }

    setModifiedRangeIDs(new Map(Array.from(itemsMap, ([id, item]) => [id, cyrb53(item.range.readTextRegions())])));

    await session.sync();

    setInProgressTask(undefined);
  };

  const checkSpelling = async () => {
    try {
      // Ensure running check multiple times preserves original style
      await clearResults();

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
      setFocusedMatch(undefined);
      setDisabledMatches(new Map);
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

          if (matches.filter(({ textId }) => itemsMap.get(textId) !== undefined).length !== matches.length) {
            setOutdated(true);
            await checkSpellingInner(session);
            return;
          }

          const enabledMatches = matches.filter((match) => !disabledMatches.has(ignoreID(matchAsIgnore(match))));

          for (const { length, offset, replacements, textId } of enabledMatches) {
            const range = itemsMap.get(textId)!.range;

            if (hasReplacment(replacements)) {
              range.replaceText({ index: offset, length }, replacements[0].value);
            }
          }

          await session.sync();

          setMatches([]);
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

  const clearFocusedMatch = (session: RichtextContentSession) => {
    session.contents.forEach((range) => {
      let endOfRegion = range.readPlaintext().length;

      range.readTextRegions().reverse().forEach((region) => {
        endOfRegion = endOfRegion - region.text.length;

        const rLink = region.formatting?.link;
        if (region.formatting?.color === FOCUS_COLOUR && rLink) {
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
                  color: ERROR_COLOUR,
                },
              );
            }
          } catch { }
        }
      });
    });
  };

  // When focusedMatch is undefined, this function clears the focused highlighting
  const focusOnMatch = async (focusedMatch: LanguageToolMatch | undefined) => {
    try {
      setInProgressTask(Task.FOCUS_MATCH);
      await editContent(
        {
          contentType: "richtext",
          target: "current_page",
        },
        async (session) => {
          clearFocusedMatch(session);

          if (focusedMatch) {
            const itemsMap = prepareMap(session.contents);

            const newID = modifiedRangeIDs.get(focusedMatch.textId);
            if (!newID) {
              return;
            }
            const item = itemsMap.get(newID);
            if (!item) {
              return;
            }

            const range = item.range;

            range.formatText(
              { index: focusedMatch.offset, length: focusedMatch.length },
              { color: FOCUS_COLOUR },
            );
          }

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

  const [modifiedRangeIDs, setModifiedRangeIDs] = useState(new Map<number, number>);
  const [focusedMatch, setFocusedMatch] = useState<LanguageToolMatch>();
  useEffect(() => {
    (async () => {
      await focusOnMatch(focusedMatch);
    })();
  }, [focusedMatch])

  // Matches disabled by menu item, for context+original+replacements triplet permanently
  // TEST: On résumé page 2
  // TODO: Try using original+replacement(s)+length+rule_id_subid
  // FIXME: possibility for overlap, but have to balance with keeping matches disabled when surrounding text/formatting changes
  // FIXME: Won't work if it's near the start of a sentence and context includes textId
  // FIXME: In general won't work with overlapping context, will change and won't be disabled
  // TODO: Store in localStorage
  const [disabledMatches, setDisabledMatches] = useState(new Map<number, MatchIgnore>);

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
            : (
              <Suggestions
                matches={matches}
                focusedMatch={focusedMatch}
                setFocusedMatch={setFocusedMatch}
                inProgressTask={inProgressTask}
                disabledMatches={disabledMatches}
                setDisabledMatches={setDisabledMatches}
              />
            )
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

  focusedMatch: LanguageToolMatch | undefined;
  setFocusedMatch: Dispatch<LanguageToolMatch | undefined>;
  inProgressTask: Task | undefined;

  disabledMatches: Map<number, MatchIgnore>,
  setDisabledMatches: Dispatch<SetStateAction<Map<number, MatchIgnore>>>;
}) => (
  <Rows spacing="1u">
    <Text variant="bold">
      Suggestions ({props.matches.length})
    </Text>
    {/* <Box */}
    {/*   background="neutralLow" */}
    {/*   borderRadius="large" */}
    {/*   padding="1u" */}
    {/* > */}
    {/*   <Checkbox */}
    {/*     label="Select all" */}
    {/*     defaultChecked={true} */}
    {/*   /> */}
    {/* </Box> */}
    {props.matches.map((match) => (
      <Suggestion
        match={match}
        focusedMatch={props.focusedMatch}
        setFocusedMatch={props.setFocusedMatch}
        inProgressTask={props.inProgressTask}
        disabledMatches={props.disabledMatches}
        setDisabledMatches={props.setDisabledMatches}
      />
    ))}
  </Rows >
);

export const Suggestion = (props: {
  match: LanguageToolMatch;

  focusedMatch: LanguageToolMatch | undefined;
  setFocusedMatch: Dispatch<LanguageToolMatch | undefined>;
  inProgressTask: Task | undefined;

  disabledMatches: Map<number, MatchIgnore>,
  setDisabledMatches: Dispatch<SetStateAction<Map<number, MatchIgnore>>>;
}) => {
  // const [expanded, setExpanded] = useState(false);

  const { textId, replacements, original } = props.match;

  const id = ignoreID(matchAsIgnore(props.match));
  const checked = !props.disabledMatches.has(id);

  return (
    <Box
      background="neutralLow"
      borderRadius="large"
      padding="1u"
      key={`${textId}${id}`}
    >
      <Box display="inline-flex" alignItems="center" justifyContent="spaceBetween" width="full">
        <Box width="full">
          <Checkbox
            label={
              <Text>
                <span style={{ ...(!checked) && { textDecoration: "line-through" } }}>
                  <span style={{ color: "red", fontWeight: "bold" }}>{original}</span>
                  {hasReplacment(replacements) && <>
                    <span> ➙ </span>
                    <span style={{ color: "green" }}>{replacements[0].value}</span>
                  </>}
                </span>
              </Text>
            }
            checked={checked}
            disabled={!hasReplacment(replacements)}
            onChange={(_, checked) => {
              const matchIgnore = matchAsIgnore(props.match);
              const id = ignoreID(matchIgnore);

              props.setDisabledMatches((prev) => {
                if (!checked) {
                  prev.set(id, matchIgnore);
                } else {
                  prev.delete(id);
                }

                return new Map(prev);
              });
            }}
          />
        </Box>

        <Button
          icon={EyeIcon}
          variant={props.focusedMatch === props.match ? "primary" : "secondary"}
          onClick={() => {
            if (props.focusedMatch === props.match) {
              props.setFocusedMatch(undefined);
            } else {
              props.setFocusedMatch(props.match);
            }
          }}
          disabled={props.inProgressTask != null}
        />

        {/* <Button */}
        {/*   icon={expanded ? ChevronUpIcon : ChevronDownIcon} */}
        {/*   size="small" */}
        {/*   variant="tertiary" */}
        {/*   onClick={() => setExpanded(!expanded)} */}
        {/* /> */}
      </Box>

      {/* {expanded && replacements.map((replacement) => ( */}
      {/*   <Text>{replacement.value}</Text> */}
      {/* ))} */}
    </Box>
  );
};

type LanguageToolParams = {
  text: string;
  language: "auto" | string;

  [key: string]: any;
};

type LanguageToolResponseMatches = {
  length: number;
  offset: number;

  type: {
    // https://github.com/languagetool-org/languagetool/blob/bd0b8ccdedbe426094049e2ccda5230ce36fc4c4/languagetool-core/src/main/proto/result_cache.proto#L17-L24
    typeName: "UnknownWord" | "Hint" | "Other";
  };

  replacements: {
    value: string;
  }[];

  context: {
    length: number;
    offset: number;
    text: string;
  };
}[]
type LanguageToolResponse = {
  matches: LanguageToolResponseMatches;
  hiddenMatches?: LanguageToolResponseMatches;
};
type LanguageToolMatch = (LanguageToolResponseMatches[0] & {
  textId: number;
  original: string;
});
type LanguageToolMatches = LanguageToolMatch[];

type MatchIgnore = Pick<LanguageToolMatch, 'context' | 'original' | 'replacements'>

function matchAsIgnore(match: LanguageToolMatch): MatchIgnore {
  const { context, original, replacements } = match;
  return { context, original, replacements };
}
function ignoreID(matchIgnore: MatchIgnore): number {
  const { context: { length, offset, text }, original, replacements } = matchIgnore;
  return cyrb53(`${text}@${offset}+${length}=${original} -> ${replacements.map((r) => r.value).join()}`);
}

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

type ItemMap = Map<number, Item>

function itemsToMap(items: Item[]): ItemMap {
  return items.reduce<ItemMap>((acc, item) => {
    acc.set(item.id, item);
    return acc;
  }, new Map);
}

function prepareMap(content: readonly RichtextContentRange[]): ItemMap {
  return itemsToMap(prepare(content));
}

// FIXME: (proj): QB messes up Lists (and not creating list in multiline text), should be fine with self-hosted or other locale

// FIXME: (lt): Many adjectives read as nouns (e.g. brilliant) https://github.com/languagetool-org/languagetool/blob/72b75d98aef09185b727a9a82cbcf9d934017ef7/languagetool-language-modules/en/src/main/resources/org/languagetool/resource/en/disambiguation.xml#L2850 DT_JJNN_IN_NN being taken wrongly?
// FIXME: (lt): <token regexp="yes">important|significant</token>
// NOTE: (lt): QB (AI-based) rules for en-US on languagetool.org
// FIXME: (lt): 2022 - Present en-dash

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
async function spellcheck(items: Item[]): Promise<[LanguageToolMatches, MatchIgnore[]]> {
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
    preferredVariants: preferredVariants || "en-GB", // FIXME:
    abtest: "deggec,esggec,ptggec,qb,gc_1_aggressive,de_gc_1_aggressive,fr_gc_1_aggressive,pt_gc_1_aggressive,nl_gc_1_aggressive,es_gc_1_aggressive",
    preferredLanguages: "en",
    disabledRules: "WHITESPACE_RULE",
    useragent: "standalone",
  }

  let matches: LanguageToolResponseMatches = []

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
  matches.push(...abtloResponse.matches, ...(abtloResponse.hiddenMatches || []));

  const tloRequest = new Request("https://api.languagetool.org/v2/check", {
    method: "POST",
    body: new URLSearchParams({
      ...baseParams,
      mode: "textLevelOnly",
    } as LanguageToolParams),
  });
  const tloData = await (await fetch(tloRequest)).text();
  const tloResponse = JSON.parse(tloData) as LanguageToolResponse;
  matches.push(...tloResponse.matches, ...(tloResponse.hiddenMatches || []));

  matches.push(...digitsMisspelled(text));

  // DEBUG
  console.debug(text, textItems);
  console.debug(abtloData, tloData);
  matches.forEach((match) => {
    const { offset, length, type: { typeName: type }, replacements } = match;
    console.debug(`${type}@${offset}+${length}=${text.substring(offset, offset + length)} -> ${replacements[0]?.value || "[]"}`);
  });
  // END DEBUG

  // Fix spelling depends on this being reverse sorted
  matches.sort(({ offset: a }, { offset: b }) => b - a);

  const fullMatches: LanguageToolMatches = matches.flatMap(({ length, offset, type, replacements, context }) => {
    const textItem = textItems.find(({ range: { offset: rOffset, length: rLength } }) => {
      return rOffset <= offset && (rOffset + rLength) >= offset + length;
    })!;

    if (!textItem) {
      return [];
    }

    const { range: { offset: rOffset }, id, plaintext, plaintextStart } = textItem;

    offset -= rOffset + plaintextStart;

    if (offset < 0) {
      return [];
    }

    return [{
      textId: id,
      length,
      offset,
      type,
      replacements,
      context,
      original: plaintext.substring(offset, offset + length),
    }];
  });

  // FIXME: Implement
  // Disabled matches need to not be coloured immediately,
  // and focusing on them should add proper style preservation
  const disabled: MatchIgnore[] = []; //fullMatches.filter(({ type: { typeName: type } }) => type === "Hint").map(matchAsIgnore);
  return [fullMatches.filter(({ type: { typeName: type } }) => type !== "Hint"), disabled];
}

function digitsMisspelled(text: string): LanguageToolResponseMatches {
  let matches: LanguageToolResponseMatches = [];

  const regex = /\S+/g;
  let results;
  while ((results = regex.exec(text)) !== null) {
    const result = results[0];
    const length = result.length;
    const offset = regex.lastIndex - length;

    if (/[a-zA-Z]/.test(result) && /\d/.test(result)) {
      matches.push({
        length,
        offset,
        type: {
          typeName: "UnknownWord",
        },
        replacements: [],
        context: {
          length,
          offset,
          text,
        }
      });
    }
  }

  return matches;
}

/**
  * https://stackoverflow.com/a/56006703
  */
function hasReplacment(replacements: LanguageToolMatch['replacements']): replacements is [LanguageToolMatch['replacements'][0], ...LanguageToolMatch['replacements']] {
  return replacements.length > 0;
}
