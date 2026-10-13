const AUTO_CHECK_INTERVAL = 30 * 1000; // 30 seconds
const LINK_BASE = "https://example.com";
const ERROR_COLOUR = "#ff0000";
const HINT_COLOUR = "#ffa500";
const FOCUS_COLOUR = "#999900";

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

import { Button, Box, Rows, Text, Checkbox, Alert, EyeIcon, CogIcon, TrashIcon, FlagIcon, Accordion, AccordionItem, Switch, Link } from "@canva/app-ui-kit";
import { editContent, InlineFormatting, RichtextContentRange, RichtextContentSession, TextRegion } from "@canva/design";
import * as styles from "styles/components.css";
import { Dispatch, SetStateAction, useEffect, useState } from "react";
import { LocalLinter, WorkerLinter } from "harper.js";
import { binaryInlined } from "harper.js/binaryInlined";
import { requestOpenExternalUrl } from "@canva/platform";

const enum Task {
  CHECK_SPELLING,
  FIX,
  FOCUS_MATCH,
  UPDATE_HIGHLIGHT,
}

const enum LocalStorageKey {
  DISABLED_MATCHES = "disabledMatches",
  DIGITS_ARE_MISSPELL = "digitsAreMisspell",
}

export const App = () => {
  const [inProgressTask, setInProgressTask] = useState<Task | undefined>(
    undefined,
  );

  const checkSpellingInner = async (session: RichtextContentSession) => {
    setInProgressTask(Task.CHECK_SPELLING);

    const items = prepare(session.contents);

    const [matches, disabled] = await spellcheck(items);
    setMatches(matches);

    const newDisabledMatches = new Map([...disabledMatches, ...disabled]);
    setDisabledMatches(newDisabledMatches);

    highlightMatches(items, matches, newDisabledMatches);

    await session.sync();

    setInProgressTask(undefined);
  };

  // Call from inside an `editContent`, and run sync after
  const highlightMatches = (items: Item[], matches: LanguageToolMatches, disabled: Map<DisabledMatchID, LanguageToolMatch>) => {
    const itemsMap = itemsToMap(items);

    // ids change when highlighting
    // Fix spelling removes the highlighting, returning the ID back to original
    // Check is run after every Fix (with no highlighting), so matches are always valid and not stale
    for (const match of matches) {
      if (disabled.has(ignoreID(match))) {
        continue;
      }

      const { length, offset, textId } = match;

      const item = itemsMap.get(textId);
      if (!item) {
        continue;
      }

      const range = item.range;

      let start = range.readPlaintext().length;
      for (const region of range.readTextRegions().reverse()) {
        const rLength = region.text.length;
        start -= rLength;

        const url = new URL(LINK_BASE);
        url.hash = btoa(JSON.stringify(region.formatting));

        const format: InlineFormatting = {
          color: ERROR_COLOUR,
          decoration: "underline",
          link: url.toString(),
        };

        formatRegion(range, length, offset, rLength, start, format);
      }
    }

    setModifiedRangeIDs(new Map(Array.from(itemsMap, ([id, item]) => [id, cyrb53(item.range.readTextRegions())])));
  };

  const formatRegion = (range: RichtextContentRange, length: number, offset: number, rLength: number, start: number, format: InlineFormatting) => {
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
  };

  const updateHighlightSingleMatch = async (match: LanguageToolMatch, highlight: boolean) => {
    try {
      setInProgressTask(Task.UPDATE_HIGHLIGHT);
      await editContent(
        {
          contentType: "richtext",
          target: "current_page",
        },
        async (session) => {
          const itemsMap = prepareMap(session.contents);

          const { length, offset, textId } = match;

          let newID = modifiedRangeIDs.get(textId);
          if (!newID) {
            return;
          }
          const item = itemsMap.get(newID);
          if (!item) {
            return;
          }

          const range = item.range;

          let start = range.readPlaintext().length;
          for (const region of range.readTextRegions().reverse()) {
            const rLength = region.text.length;
            start -= rLength;

            if (highlight) {
              const url = new URL(LINK_BASE);
              url.hash = btoa(JSON.stringify(region.formatting));

              const format: InlineFormatting = {
                color: ERROR_COLOUR,
                decoration: "underline",
                link: url.toString(),
              };

              formatRegion(range, length, offset, rLength, start, format);
            } else {
              if (start >= offset && start + rLength <= offset + length) {
                const values = preservationLinkValues(region);
                if (values) {
                  range.formatText(
                    {
                      index: start,
                      length: rLength,
                    },
                    values.formatting,
                  );
                }
              }
            }
          }

          await session.sync();

          setModifiedRangeIDs(new Map(modifiedRangeIDs.set(textId, cyrb53(range.readTextRegions()))));
        },
      );
      setInProgressTask(undefined);
    } catch (error) {
      console.error(error);
    }
  };

  const checkSpelling = async () => {
    try {
      // Ensure running check multiple times preserves original style
      await clearResults();

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
        for (const range of session.contents) {
          let start = range.readPlaintext().length;
          for (const region of range.readTextRegions().reverse()) {
            const rLength = region.text.length;
            start -= rLength;

            const values = preservationLinkValues(region);
            if (values) {
              range.formatText(
                {
                  index: start,
                  length: rLength,
                },
                values.formatting,
              );
            }
          }
        }

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

          if (matches.filter(({ textId }) => itemsMap.get(textId) !== undefined).length !== matches.length) {
            setOutdated(true);
            await checkSpellingInner(session);
            return;
          }

          const enabledMatches = matches.filter((match) => !disabledMatches.has(ignoreID(match)));

          for (const { length, offset, replacements, textId } of enabledMatches) {
            const item = itemsMap.get(textId);
            if (!item) {
              continue;
            }

            if (hasReplacment(replacements)) {
              item.range.replaceText({ index: offset, length }, replacements[0].value);
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

  const clearFocusedMatch = async (session: RichtextContentSession) => {
    for (const range of session.contents) {
      const modifiedID = cyrb53(range.readTextRegions());
      const textId = [...modifiedRangeIDs].find(([_, modified]) => modified === modifiedID)?.[0];

      let endOfRegion = range.readPlaintext().length;

      let found;
      for (const region of range.readTextRegions().reverse()) {
        endOfRegion = endOfRegion - region.text.length;

        if (region.formatting?.color === FOCUS_COLOUR) {
          // Either return to original (if ignored/disabled), or to highlighted match
          const values = preservationLinkValues(region);
          if (values) {
            range.formatText(
              {
                index: endOfRegion,
                length: region.text.length,
              },
              values.wasPlain ? values.formatting : {
                color: ERROR_COLOUR,
              },
            );
          }
          found = true;
        }
      }

      if (found && textId) {
        setModifiedRangeIDs(new Map(modifiedRangeIDs.set(textId, cyrb53(range.readTextRegions()))));
        return;
      }
    }
  };

  // When focusedMatch is undefined, this function clears the focused highlighting
  const focusOnMatch = async (focusedMatch?: LanguageToolMatch) => {
    try {
      setInProgressTask(Task.FOCUS_MATCH);
      await editContent(
        {
          contentType: "richtext",
          target: "current_page",
        },
        async (session) => {
          await clearFocusedMatch(session);

          if (focusedMatch) {
            const itemsMap = prepareMap(session.contents);

            const { length, offset, textId } = focusedMatch;

            const newID = modifiedRangeIDs.get(textId);
            if (!newID) {
              return;
            }
            const item = itemsMap.get(newID);
            if (!item) {
              return;
            }

            const range = item.range;

            let start = range.readPlaintext().length;
            for (const region of range.readTextRegions().reverse()) {
              const rLength = region.text.length;
              start -= rLength;

              // Only used if not highlighted (plain)
              const url = new URL(LINK_BASE);
              url.hash = btoa(JSON.stringify({
                ...region.formatting,
                wasPlain: true,
              }));
              const format: InlineFormatting = preservationLinkValues(region) ? {
                // If region is already highlighted, just change colour
                color: FOCUS_COLOUR,
              } : {
                // Otherwise add highlighting
                color: FOCUS_COLOUR,
                decoration: "underline",
                link: url.toString(),
              };

              formatRegion(range, length, offset, rLength, start, format);
            }

            setModifiedRangeIDs(modifiedRangeIDs.set(textId, cyrb53(range.readTextRegions())));
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
      if (inProgressTask === null) {
        await checkSpelling();
      }
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

  // Matches disabled by menu item, identified by some set of keys in the match (see ignoreID for details)
  const [disabledMatches, setDisabledMatches] = useState(load(LocalStorageKey.DISABLED_MATCHES, Map<DisabledMatchID, LanguageToolMatch>, (v) => new Map(v)));
  useEffect(() => {
    store(LocalStorageKey.DISABLED_MATCHES, disabledMatches, (v) => [...v]);
  }, [disabledMatches]);

  const [settingsVisible, setSettingsVisible] = useState(false);
  useEffect(() => {
    if (!settingsVisible) {
      (async () => {
        await checkSpelling();
      })();
    }
  }, [settingsVisible])

  return (
    <div className={styles.scrollContainer}>
      <Rows spacing="2u">
        {outdated && <Alert tone="critical">
          Content has changed since the last spellcheck.
          Please review the new results and press "Fix" again.
        </Alert>}

        <Box display="inline-flex" alignItems="center" justifyContent="spaceBetween" width="full">
          <Box width="full">
            <Button
              stretch
              variant="secondary"
              onClick={checkSpelling}
              disabled={inProgressTask != null}
              loading={inProgressTask === Task.CHECK_SPELLING}
            >
              Check
            </Button>
          </Box>

          <Button
            icon={CogIcon}
            size="small"
            variant="tertiary"
            onClick={() => setSettingsVisible(!settingsVisible)}
          />
        </Box>

        {settingsVisible
          ? (
            <Settings
              disabledMatches={disabledMatches}
              setDisabledMatches={setDisabledMatches}
            />
          ) : (
            <>
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
                      updateHighlightSingleMatch={updateHighlightSingleMatch}
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
            </>
          )
        }
      </Rows>
    </div>
  );
};

export const Settings = (props: {
  disabledMatches: Map<DisabledMatchID, LanguageToolMatch>,
  setDisabledMatches: Dispatch<SetStateAction<Map<DisabledMatchID, LanguageToolMatch>>>;
}) => {
  const [digitsAreMisspell, setDigitsAreMisspell] = useState(() => {
    const value = localStorage.getItem(LocalStorageKey.DIGITS_ARE_MISSPELL);
    return value ? JSON.parse(value) : true;
  });
  useEffect(() => {
    store(LocalStorageKey.DIGITS_ARE_MISSPELL, digitsAreMisspell, (v) => v);
  }, [digitsAreMisspell]);

  const disabledMatches = [...props.disabledMatches].filter(([_, { type: { typeName: type } }]) => type !== "Hint");

  return (
    <>
      <Text variant="bold" size="large">Settings</Text>

      <Switch
        value={digitsAreMisspell}
        label="Words with numbers are spelling errors"
        onChange={(value) => setDigitsAreMisspell(value)}
      />

      <Accordion dividers={false}>
        <AccordionItem title={`Ignored Results (${disabledMatches.length})`}>
          <Rows spacing="1u">
            {disabledMatches.length > 0 && (
              <Button
                variant="secondary"
                stretch
                onClick={() => props.setDisabledMatches(new Map)}
              >
                Remove all
              </Button>
            )}

            {disabledMatches.map(([id, match]) => (
              <Box
                display="inline-flex" alignItems="center" justifyContent="spaceBetween" width="full"
              >
                <Box width="full">
                  <Text>{match.original}</Text>
                </Box>
                <Button
                  icon={TrashIcon}
                  variant="secondary"
                  key={id}
                  onClick={() => {
                    props.setDisabledMatches((prev) => {
                      prev.delete(id);
                      return new Map(prev);
                    });
                  }}
                />
              </Box>
            ))}
          </Rows>
        </AccordionItem>
      </Accordion>

      <Text variant="bold" size="large">About</Text>

      <Text tagName="p" size="small">
        Spelling &amp; Grammar checker by <Link
          ariaLabel="ktprograms"
          href="https://ktprograms.codeberg.page/blog/"
          requestOpenExternalUrl={async () => {
            await requestOpenExternalUrl({
              url: "https://ktprograms.codeberg.page/blog/",
            });
          }}
        >
          ktprograms
        </Link>

        <br />

        Uses <Link
          ariaLabel="LanguageTool"
          href="https://languagetool.org"
          requestOpenExternalUrl={async () => {
            await requestOpenExternalUrl({
              url: "https://languagetool.org",
            });
          }}
        >
          LanguageTool
        </Link> for matches and suggestions.
      </Text>
    </>
  );
};

export const Suggestions = (props: {
  matches: LanguageToolMatches;

  focusedMatch?: LanguageToolMatch;
  setFocusedMatch: Dispatch<LanguageToolMatch | undefined>;
  inProgressTask?: Task;

  disabledMatches: Map<DisabledMatchID, LanguageToolMatch>,
  setDisabledMatches: Dispatch<SetStateAction<Map<DisabledMatchID, LanguageToolMatch>>>;

  updateHighlightSingleMatch: (match: LanguageToolMatch, highlight: boolean) => Promise<void>;
}) => {
  const [onlyEnabled, setOnlyEnabled] = useState(false);

  const matches = onlyEnabled ? props.matches.filter((match) => !props.disabledMatches.has(ignoreID(match))) : props.matches

  return (
    <Rows spacing="1u">
      <Box display="inline-flex" alignItems="center" justifyContent="spaceBetween" width="full">
        <Box width="full">
          <Text variant="bold">
            Suggestions ({matches.length})
          </Text>
        </Box>

        <Button
          icon={FlagIcon}
          variant="tertiary"
          size="small"
          pressed={onlyEnabled}
          onClick={() => setOnlyEnabled(!onlyEnabled)}
        />
      </Box>
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
      {matches.map((match) => (
        <Suggestion
          key={`${match.textId}${ignoreID(match)}`}
          match={match}
          focusedMatch={props.focusedMatch}
          setFocusedMatch={props.setFocusedMatch}
          inProgressTask={props.inProgressTask}
          disabledMatches={props.disabledMatches}
          setDisabledMatches={props.setDisabledMatches}
          updateHighlightSingleMatch={props.updateHighlightSingleMatch}
        />
      ))}
    </Rows >
  );
};

export const Suggestion = (props: {
  match: LanguageToolMatch;

  focusedMatch?: LanguageToolMatch;
  setFocusedMatch: Dispatch<LanguageToolMatch | undefined>;
  inProgressTask?: Task;

  disabledMatches: Map<DisabledMatchID, LanguageToolMatch>,
  setDisabledMatches: Dispatch<SetStateAction<Map<DisabledMatchID, LanguageToolMatch>>>;

  updateHighlightSingleMatch: (match: LanguageToolMatch, highlight: boolean) => Promise<void>;
}) => {
  // const [expanded, setExpanded] = useState(false);

  const { replacements, original, type: { typeName } } = props.match;

  const checked = !props.disabledMatches.has(ignoreID(props.match));

  return (
    <Box
      background="neutralLow"
      borderRadius="large"
      padding="1u"
    >
      <Box display="inline-flex" alignItems="center" justifyContent="spaceBetween" width="full">
        <Box width="full">
          <Checkbox
            label={
              <Text>
                <span style={{ ...(!checked) && { textDecoration: "line-through" } }}>
                  <span style={{ color: typeName === "Hint" ? HINT_COLOUR : ERROR_COLOUR, fontWeight: "bold" }}>{original}</span>
                  {hasReplacment(replacements) && <>
                    <span> ➙ </span>
                    <span style={{ color: "green" }}>{replacements[0].value}</span>
                  </>}
                </span>
              </Text>
            }
            checked={checked}
            disabled={!hasReplacment(replacements)}
            onChange={async (_, checked) => {
              const id = ignoreID(props.match);

              props.setDisabledMatches((prev) => {
                if (!checked) {
                  prev.set(id, props.match);
                } else {
                  prev.delete(id);
                }

                return new Map(prev);
              });

              await props.updateHighlightSingleMatch(props.match, checked);
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

  rule: {
    id: string;
    subId?: string;
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

type DisabledMatchID = string;

function ignoreID(match: LanguageToolMatch): DisabledMatchID {
  /** Old ID generation method
   * possibility for overlap, but have to balance with keeping matches disabled when surrounding text/formatting changes
   * Won't work if it's near the start of a sentence and context includes textId
   * In general won't work with overlapping context, will change and won't be disabled
  const { context: { length, offset, text }, original, replacements } = matchIgnore;
  return cyrb53(`${text}@${offset}+${length}=${original} -> ${replacements.map((r) => r.value).join()}`);
  */

  const { original, replacements, length, rule: { id, subId } } = match;
  return `${id}${subId ? "." + subId : ""}: ${original}[${length}] -> ${replacements.map((r) => r.value).join()}`;
}

type Item = {
  id: number;
  plaintext: string;
  range: RichtextContentRange;
}

function prepare(contents: readonly RichtextContentRange[]): Item[] {
  return contents.map((range) => {
    return {
      id: cyrb53(range.readTextRegions()), // FIXME: Same text+formatting leads to same (if from Duplicate)
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
async function spellcheck(items: Item[]): Promise<[LanguageToolMatches, Map<DisabledMatchID, LanguageToolMatch>]> {
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
  const preferredVariants = navigator.languages.filter((locale) => new Intl.Locale(locale).region !== undefined).reverse().join();
  const baseParams: LanguageToolParams = {
    text,
    language: "auto",
    enableHiddenRules: true,
    level: "picky",
    noopLanguages: "en",
    preferredVariants: preferredVariants || "en-GB",
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

  const additionalMatches = [...digitsMisspelled(text), ...antAnceEntEnce(text)];
  for (const additionalMatch of additionalMatches) {
    if (!matches.find((match) => match.offset === additionalMatch.offset && match.length === additionalMatch.length)) {
      matches.push(additionalMatch);
    }
  }

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

  const fullMatches: LanguageToolMatches = matches.flatMap(({ length, offset, type, replacements, context, rule }) => {
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
      rule,
      original: plaintext.substring(offset, offset + length),
    }];
  });

  // TODO: Add "enabledHints" to counteract auto disabled
  // TODO: Add to dictionary (either localStorage or shared account storage)
  const disabled = new Map(fullMatches.filter(({ type: { typeName: type } }) => type === "Hint").map((match) => [ignoreID(match), match]));
  return [fullMatches, disabled];
}

function digitsMisspelled(text: string): LanguageToolResponseMatches {
  let matches: LanguageToolResponseMatches = [];

  const value = localStorage.getItem(LocalStorageKey.DIGITS_ARE_MISSPELL);
  if (value && JSON.parse(value) === true) {
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
          },
          rule: {
            id: "__CUSTOM_NUMBERS_SPELLING_ERROR__",
          },
        });
      }
    }
  }

  return matches;
}

function antAnceEntEnce(text: string): LanguageToolResponseMatches {
  let matches: LanguageToolResponseMatches = [];

  const regex = /(?<before>^|an? |the )(?<result>bouyant|compliant|forbearant|important|reliant|significant|coherent|eloquent|excellent|persistent|reverent|subsistent|urgent) of/gim;
  let results;
  while ((results = regex.exec(text)) !== null) {
    const before = results.groups?.before;
    const result = results.groups?.result;
    if (before === undefined || result === undefined) {
      continue;
    }

    const length = result.length;
    const offset = regex.lastIndex - results[0].length + before.length;

    matches.push({
      length,
      offset,
      type: {
        typeName: "Other",
      },
      replacements: [
        {
          value: result.replace(/ant$/, "ance").replace(/ent$/, "ence"),
        },
      ],
      context: {
        length,
        offset,
        text,
      },
      rule: {
        id: "__CUSTOM_ARTICLE_ADJECTIVE_OF_5__"
      }
    });
  }

  return matches;
}

/**
  * https://stackoverflow.com/a/56006703
  */
function hasReplacment(replacements: LanguageToolMatch['replacements']): replacements is [LanguageToolMatch['replacements'][0], ...LanguageToolMatch['replacements']] {
  return replacements.length > 0;
}

function preservationLinkValues(region: TextRegion): { formatting: InlineFormatting, wasPlain: boolean } | undefined {
  if (region.formatting?.link) {
    try {
      const {
        color, fontWeight, fontStyle, decoration, strikethrough, link, wasPlain
      } = JSON.parse(atob(new URL(region.formatting.link).hash.substring(1))) as InlineFormatting & { wasPlain?: boolean };

      // Make sure not to run format on other URLs which happen to match the format
      if (
        color !== undefined &&
        fontWeight !== undefined &&
        fontStyle !== undefined &&
        decoration !== undefined &&
        strikethrough !== undefined &&
        link !== undefined
      ) {
        return {
          formatting: { color, fontWeight, fontStyle, decoration, strikethrough, link },
          wasPlain: wasPlain || false,
        };
      }
    } catch { }
  }

  return;
}

// MARK: - Persistence

function load<T>(key: string, type: new () => T, decode: (value: any) => T): () => T {
  return () => {
    const value = localStorage.getItem(key);
    return value ? decode(JSON.parse(value)) : new type;
  };
};

function store<T>(key: string, value: T, encode: (value: T) => any) {
  const json = JSON.stringify(encode(value));
  localStorage.setItem(key, json);
};
