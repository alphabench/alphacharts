# Script grammar

Tokens: names `[A-Za-z_][A-Za-z0-9_]*` (ASCII only). Numbers `12`, `1.5`, `1e3`. Strings in `"..."` or `'...'` with the
escapes `\n \t \\ \" \'`. Colours `#rrggbb` or `#rrggbbaa`. Keywords `if else for to by var and or not true false`. Type
names `int float bool string color`. Operators `:= == != <= >= += -= *= /= %= + - * / % < > = ? : ( ) [ ] , .`.
Comments start with `//`. Blocks are indentation in spaces.

```text
program     = { statement } ;
statement   = declaration | tuple | assignment | if | for | call NEWLINE ;
declaration = [ "var" ] [ type ] IDENT "=" expr NEWLINE ;
tuple       = "[" IDENT { "," IDENT } "]" "=" expr NEWLINE ;
assignment  = IDENT ( ":=" | "+=" | "-=" | "*=" | "/=" | "%=" ) expr NEWLINE ;
if          = "if" expr block [ "else" ( if | block ) ] ;
for         = "for" IDENT "=" expr "to" expr [ "by" expr ] block ;
block       = NEWLINE INDENT statement { statement } DEDENT ;
expr        = or [ "?" expr ":" expr ] ;
or          = and { "or" and } ;      and = not { "and" not } ;      not = "not" not | cmp ;
cmp         = add [ ( "==" | "!=" | "<" | "<=" | ">" | ">=" ) add ] ;
add         = mul { ( "+" | "-" ) mul } ;   mul = unary { ( "*" | "/" | "%" ) unary } ;
unary       = ( "-" | "+" ) unary | postfix ;
postfix     = primary { "(" [ arg { "," arg } ] ")" | "[" expr "]" | "." IDENT } ;
arg         = [ IDENT "=" ] expr ;
primary     = NUMBER | STRING | COLOR | "true" | "false" | IDENT | "(" expr ")" | "[" [ expr { "," expr } ] "]" ;
```

Precedence, loosest to tightest: `?:`, `or`, `and`, `not`, comparison, `+ -`, `* / %`, unary `- +`, postfix. Comparisons do
not chain: write `a < b and b < c`. An array literal is accepted only as `options=[...]` of `input.string`. A statement that
is a bare expression must be a call. `.` follows only a namespace name (`ta math input color plot shape location hline`).
Named arguments (`name=value`) come after the positional ones.
