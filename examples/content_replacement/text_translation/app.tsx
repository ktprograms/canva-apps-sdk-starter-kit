// For usage information, see the README.md file.
import { Button, Box, Rows, Text, Checkbox } from "@canva/app-ui-kit";
import { editContent, InlineFormatting } from "@canva/design";
import * as styles from "styles/components.css";
import { convertWordsToLorem } from "./lorem_generator";
import { Dispatch, SetStateAction, useEffect, useState } from "react";

const enum Task {
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
  const spellcheckWithoutFormatting = async () => {
    setInProgressTask(Task.WITHOUT_FORMATTING);
    // Start a content editing session for all richtext elements on the current page
    await editContent(
      {
        contentType: "richtext",
        target: "current_page",
      },
      async (session) => {
        // Extract plaintext from each richtext element, ignoring any formatting like bold, italic, etc.
        const request: string[] = session.contents.map((range) => range.readPlaintext());

        // Simulate a translation API call (in production, this would call a real translation service)
        const response = await spellcheck(request, setMatches);

        // Apply translations to each richtext element in the design
        session.contents.forEach((range, i) => {
          // Get the length of the original text to know how much to replace
          const length = range.readPlaintext().length;
          // Replace the entire text content with the translated text
          const spellcheckedText = response[i];
          if (spellcheckedText) {
            range.replaceText({ index: 0, length }, spellcheckedText);
          }
        });

        // Commit all changes to the design - this makes the changes visible to the user
        await session.sync();
      },
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

  const [shouldMark, setShouldMark] = useState(false);

  useEffect(() => {
    const interval = setInterval(async () => {
      if (shouldMark) {
        await mark()
      }
      // try {
      //   await editContent(
      //     {
      //       contentType: "richtext",
      //       target: "current_page",
      //     },
      //     async (session) => {
      //       for (const range of session.contents) {
      //         for (const region of range.readTextRegions()) {
      //           console.log(region.text);
      //         }
      //       }
      //       // notification.addToast({
      //       //   messageText: session.contents.map((range) => range.readPlaintext()).join(", ") || session.contents.toString(),
      //       // });
      //     },
      //   );
      // } catch (error) {
      //   console.error(error);
      // }
    }, 1000);

    return () => clearInterval(interval);
  }, [shouldMark]);

  const [matches, setMatches] = useState<LanguageToolMatches>([]);

  return (
    <div className={styles.scrollContainer}>
      <Rows spacing="2u">
        <Text>
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
        </Button>
        <Button
          variant="secondary"
          onClick={spellcheckWithoutFormatting}
          disabled={inProgressTask != null}
          loading={inProgressTask === Task.WITHOUT_FORMATTING}
        >
          Spellcheck without formatting
        </Button>
        <Button
          variant="secondary"
          onClick={() => setShouldMark(!shouldMark)}
          disabled={inProgressTask != null}
          loading={inProgressTask === Task.MARK}
        >
          Mark randomly {String(shouldMark)}
        </Button>

        <Suggestions matches={matches} />
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
    {props.matches.map(({ length, offset, replacements, original }) => {
      // FIXME: Range errors
      const replacement = replacements[0]!.value;

      return (
        <Box
          background="neutralLow"
          borderRadius="large"
          padding="1u"
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
  </Rows>
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
  original: string;

  // TODO: Add "ignored" for checkbox (optional)
})[]

type SetMatchesAction = Dispatch<SetStateAction<LanguageToolMatches>>

// FIXME: Error handling
// TODO: Allow picking other replacements
async function spellcheck(
  text: string[],
  setMatches: SetMatchesAction,
): Promise<string[]> {
  const t = "The quic brown fox jumps over an lazy dog";
  const request = new Request("https://api.languagetool.org/v2/check", {
    method: "POST",
    body: new URLSearchParams({
      text: t || text,
      language: "auto",
    }),
  });

  const data = await (await fetch(request)).text();
  console.log(data);
  const response = JSON.parse(data) as LanguageToolResponse;

  response.matches.forEach((match) => {
    const { offset, length, replacements } = match;
    console.log(`@${offset}+${length}=${t.substring(offset, offset + length)} -> ${replacements[0]!.value}`);
  });

  setMatches(response.matches.map((match) => {
    const { offset, length } = match;

    // FIXME: Range
    const original = (t || text).substring(offset, offset + length);

    return {
      ...match,
      original,
    }
  }));

  return Promise.resolve([""]);
}
