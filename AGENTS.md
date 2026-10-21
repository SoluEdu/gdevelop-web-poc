# Agent notes

## XERJ (code search)

This project uses XERJ for reference coding. Before writing code that touches
unfamiliar territory: `xerj def "<symbol>"` for go-to-definition, or
`xerj search "<plain words>"` for ranked, definition-first passages.
Index a repo with `xerj autoindex <folder>`. Cite file:line for anything you rely on.

This project is indexed under the `opfs` prefix, so always pass it:

    xerj search --prefix opfs "plain words"
    xerj def "<symbol>"
    xerj autoindex . --prefix opfs     # reindex after big changes

The node at http://localhost:9200 must be running: `xerj --insecure --data-dir ~/xerj-data`.
