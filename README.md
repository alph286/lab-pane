# lab-pane

Mod di Claude Code: il pannello `lab` mostra in diretta il log dei lavori sulla GPU del lab, con una riga sullo stato della GPU (utilizzo, VRAM, chi tiene il lock e da quanto).

- Si apre da solo quando parte un subagente `lab-runner`, oppure con `/lab`; `/lab stop` chiude la connessione.
- Segue `~/log/corrente` sul lab; se manca, il log più recente in `~/log/*/*.log`, poi in `~/prove/*/*.log`.
- Una sola connessione `ssh` in sola lettura; se cade riprova da sola (15, 30, 60 s, poi ogni 60 s).
- Si ferma da sola quando nessun lab-runner è attivo, il lock della GPU è libero e il lavoro è finito (`Fatto`/`ERRORE` da 2 minuti) oppure il log è fermo da 30 minuti.

Opzioni (in `/config`): `host` (default `lab`), `rows` (14), `openOnLabRunner` (true).

## Installazione

Al prompt di Claude Code:

```
/plugin install lab-pane --marketplace alph286/lab-pane
```

Da una shell:

```
claude plugin install lab-pane --marketplace alph286/lab-pane
```

Il repo è privato: serve una credenziale git per github.com sul dispositivo (chiave SSH, oppure `gh auth login` e `gh auth setup-git`).

## Sviluppo

```
claude plugin validate .
claude plugin test .
claude --plugin-dir .
```
