# Word frequency lists

`en.txt` and `de.txt`: the 30,000 most used English and German words, most used first. They sort spelling
suggestions so the everyday word wins ("cooked" before "cocked") and find sound-alike words the dictionary misses.

Source: [FrequencyWords](https://github.com/hermitdave/FrequencyWords) by Hermit Dave (2018 lists, from OpenSubtitles),
licence CC BY-SA 4.0. Changed here: counts removed, cut to 30,000 words, only words the app's spell check dictionaries
accept, German nouns given back their capital letter.

# Word pair lists

`en-pairs.txt` and `de-pairs.txt`: words that often stand next to each other, one line per first word
(`first follower follower …`). They let the words around a misspelling pick the fix ("a piece of", "world peace").

- English: 150,000 pairs from the bigram list of [SymSpell](https://github.com/wolfgarbe/SymSpell) by Wolf Garbe (MIT),
  which is built from the [Google Books Ngram data](https://storage.googleapis.com/books/ngrams/books/datasetsv3.html)
  (CC BY 3.0) and SCOWL. Changed here: counts removed, cut to the most used pairs, grouped by first word.
- German: about 5,000 pairs from [google-books-ngram-frequency](https://github.com/orgtre/google-books-ngram-frequency)
  by orgtre, also built from the Google Books Ngram data (CC BY 3.0). Changed here: counts removed, grouped by first word.
