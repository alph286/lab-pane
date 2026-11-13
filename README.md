# lab-pane

Mod di Claude Code: il pannello `lab` mostra in diretta il log dei lavori sulla GPU del lab, con una riga sullo stato della GPU (utilizzo, VRAM, chi tiene il lock e da quanto).

- Si apre da solo quando parte un subagente `lab-runner`, oppure con `/lab`; `/lab stop` chiude la connessione.
- Segue `~/log/corrente` sul lab; se manca, il log più recente in `~/log/*/*.log`, poi in `~/prove/*/*.log`.
- Una sola connessione `ssh` in sola lettura; se cade riprova da sola (15, 30, 60 s, poi ogni 60 s).
- Si ferma da sola quando nessun lab-runner è attivo, il lock della GPU è libero e il lavoro è finito (`Fatto`/`ERRORE` da 2 minuti) oppure il log è fermo da 30 minuti.

Opzioni (in `/config`): `host` (default `lab`), `rows` (14), `openOnLabRunner` (true).

## Installazione

Da una shell:

```
claude plugin marketplace add alph286/lab-pane
claude plugin install lab-pane@lab-pane
```

Oppure al prompt di Claude Code: `/plugin marketplace add alph286/lab-pane`, poi `/plugin install lab-pane@lab-pane`. Poi riavvia Claude Code.

Serve un `ssh lab` che funzioni senza password (chiave autorizzata e voce `lab` in `~/.ssh/config`); per un altro nome cambia l'opzione `host`. Prova:

```
ssh lab hostname
```

Aggiornare: `claude plugin marketplace update lab-pane` e `claude plugin update lab-pane@lab-pane`, poi riavvia Claude Code.

## Sviluppo

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```
