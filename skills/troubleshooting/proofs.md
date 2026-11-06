# Proofs

One invalid script for each diagnostic a script can produce. The checker compiles and runs every block and requires the
named diagnostic exactly; it is how the troubleshooting rows are known to be real. Not meant to be read by a model.

<!-- skill: invalid: 'while' is not supported: loops must be bounded, use 'for i = a to b' -->
```alphacharts
while close > 1
    x = 1
plot(close)
```

<!-- skill: invalid: 'switch' is not supported: use if / else -->
```alphacharts
switch close
plot(close)
```

<!-- skill: invalid: functions are not supported -->
```alphacharts
function f(x)
    x
plot(close)
```

<!-- skill: invalid: 'return' is not supported -->
```alphacharts
x = return
plot(close)
```

<!-- skill: invalid: 'import' is not supported -->
```alphacharts
import x
plot(close)
```

<!-- skill: invalid: 'export' is not supported -->
```alphacharts
export x = 1
plot(close)
```

<!-- skill: invalid: 'break' is not supported: loops are bounded -->
```alphacharts
for i = 1 to 3
    break
plot(close)
```

<!-- skill: invalid: 'continue' is not supported -->
```alphacharts
for i = 1 to 3
    continue
plot(close)
```

<!-- skill: invalid: 'class' is not supported -->
```alphacharts
class A
plot(close)
```

<!-- skill: invalid: 'eval' is not part of the language -->
```alphacharts
x = eval("1")
plot(close)
```

<!-- skill: invalid: 'this' is not part of the language -->
```alphacharts
x = this
plot(close)
```

<!-- skill: invalid: there is no 'null'; use na -->
```alphacharts
x = null
plot(close)
```

<!-- skill: invalid: there is no 'undefined'; use na -->
```alphacharts
x = undefined
plot(close)
```

<!-- skill: invalid: 'constructor' is a reserved name -->
```alphacharts
constructor = 1
plot(close)
```

<!-- skill: invalid: 'prototype' is a reserved name -->
```alphacharts
prototype = 1
plot(close)
```

<!-- skill: invalid: '__proto__' is a reserved name -->
```alphacharts
x = __proto__
plot(close)
```

<!-- skill: invalid: tab characters are not allowed; indent with spaces -->
```alphacharts
x = 1
	plot(close)
```

<!-- skill: invalid: indentation does not match any outer block -->
```alphacharts
if close > open
    x = 1
  y = 2
plot(close)
```

<!-- skill: invalid: invalid number "12abc" -->
```alphacharts
x = 12abc
plot(close)
```

<!-- skill: invalid: number "1e999" is out of range -->
```alphacharts
x = 1e999
plot(close)
```

<!-- skill: invalid: unknown escape "\q" -->
```alphacharts
x = "a\qb"
plot(close)
```

<!-- skill: invalid: unterminated string -->
```alphacharts
plot("abc)
```

<!-- skill: invalid: invalid color "#12": use #RRGGBB or #RRGGBBAA -->
```alphacharts
x = #12
plot(close)
```

<!-- skill: invalid: unexpected character "$" -->
```alphacharts
plot(close) $
```

<!-- skill: invalid: unclosed bracket -->
```alphacharts
plot(
```

<!-- skill: invalid: expected ")" to close the call, found end of line -->
```alphacharts
plot(close
```

<!-- skill: invalid: unexpected indent -->
```alphacharts
x = 1
	plot(close)
```

<!-- skill: invalid: unexpected ")"; expected end of line -->
```alphacharts
plot(close))
```

<!-- skill: invalid: expected end of line before the indented block, found "x" -->
```alphacharts
if close > open x = 1
    y = 2
plot(close)
```

<!-- skill: invalid: expected an indented block -->
```alphacharts
if close > open
x = 1
plot(close)
```

<!-- skill: invalid: a block needs at least one statement -->
```alphacharts
if close > open
    x =
plot(close)
```

<!-- skill: invalid: expected a name, found "1" -->
```alphacharts
[a, 1] = ta.macd(close)
plot(close)
```

<!-- skill: invalid: this expression has no effect; a statement is a declaration, an assignment, if, for or a call -->
```alphacharts
close
plot(close)
```

<!-- skill: invalid: expected a variable name, found "5" -->
```alphacharts
var 5 = 1
plot(close)
```

<!-- skill: invalid: expected a loop variable name, found "1" -->
```alphacharts
for 1 = 1 to 3
    x = 1
plot(close)
```

<!-- skill: invalid: expected "to", found "3" -->
```alphacharts
for i = 1 3
    x = 1
plot(close)
```

<!-- skill: invalid: expression is nested too deeply -->
```alphacharts
plot(((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((((close)))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))))
```

<!-- skill: invalid: comparisons do not chain; combine them with 'and' -->
```alphacharts
plot(1 < 2 < 3)
```

<!-- skill: invalid: expected a name after ".", found end of line -->
```alphacharts
x = ta.
plot(close)
```

<!-- skill: invalid: expected an expression, found end of line -->
```alphacharts
x = 
```

<!-- skill: invalid: "x" is already declared -->
```alphacharts
x = close
x = open
plot(x)
```

<!-- skill: invalid: "close" is a built-in name and cannot be redeclared -->
```alphacharts
close = 5
plot(close)
```

<!-- skill: invalid: 'var' is only allowed at the top level of the script -->
```alphacharts
var x = 0
if close > open
    var y = 1
plot(x)
```

<!-- skill: invalid: input.* may only declare a top-level variable -->
```alphacharts
if close > open
    x = input.int(5)
plot(close)
```

<!-- skill: invalid: plot() is only allowed at the top level of the script -->
```alphacharts
if close > open
    p = plot(close)
plot(close)
```

<!-- skill: invalid: a plot handle cannot be declared var or typed -->
```alphacharts
var p = plot(close)
```

<!-- skill: invalid: this expression has no value -->
```alphacharts
x = hline(5)
plot(close)
```

<!-- skill: invalid: a plot handle can only come from plot() -->
```alphacharts
x = 1
p = plot(close)
y = p
plot(close)
```

<!-- skill: invalid: this call returns 3 values; destructure them: [a, b, ...] = ... -->
```alphacharts
a = ta.macd(close, 12, 26, 9)
plot(a)
```

<!-- skill: invalid: cannot assign int to bool "x" -->
```alphacharts
bool x = 1
plot(close)
```

<!-- skill: invalid: cannot infer the type of "x" from na; declare it, e.g. float x = na -->
```alphacharts
x = na
plot(close)
```

<!-- skill: invalid: destructuring is only allowed at the top level of the script -->
```alphacharts
if close > open
    [a, b] = ta.macd(close)
plot(close)
```

<!-- skill: invalid: only calls that return several values can be destructured -->
```alphacharts
[a, b] = ta.sma(close, 3)
plot(a)
```

<!-- skill: invalid: this call returns 3 values, 2 names given -->
```alphacharts
[a, b] = ta.macd(close, 12, 26, 9)
plot(a)
```

<!-- skill: invalid: "a" is destructured from a call and cannot be assigned with := -->
```alphacharts
[a, b] = ta.aroon()
a := 1
plot(a)
```

<!-- skill: invalid: "x" is not declared; declare it first with x = ... -->
```alphacharts
x := 1
plot(close)
```

<!-- skill: invalid: cannot assign to "i": it is a loop counter -->
```alphacharts
for i = 1 to 3
    i := 2
plot(close)
```

<!-- skill: invalid: "+" needs numbers, got string and int -->
```alphacharts
plot("a" + 1)
```

<!-- skill: invalid: cannot assign float to int "x" (declare it float: e.g. x = 0.0) -->
```alphacharts
x = 1
x := 1.5
plot(x)
```

<!-- skill: invalid: the condition of if must be bool, got series float -->
```alphacharts
if close
    x = 1
plot(close)
```

<!-- skill: invalid: a loop bound must be an int, got float -->
```alphacharts
for i = 1.5 to 10
    x = 1
plot(close)
```

<!-- skill: invalid: the loop step cannot be 0 -->
```alphacharts
for i = 1 to 10 by 0
    x = 1
plot(close)
```

<!-- skill: invalid: this loop runs 100000 times; the limit is 10000 iterations per loop -->
```alphacharts
for i = 1 to 100000
    x = 1
plot(close)
```

<!-- skill: invalid: array values are only allowed as options=[...] of input.string -->
```alphacharts
x = [1, 2]
plot(close)
```

<!-- skill: invalid: "ta" is a namespace; use ta.<name> -->
```alphacharts
plot(ta)
```

<!-- skill: invalid: "nz" is a function; call it: nz(...) -->
```alphacharts
x = nz
plot(close)
```

<!-- skill: invalid: unknown name "clos" -->
```alphacharts
plot(clos)
```

<!-- skill: invalid: only namespace names can be followed by '.' -->
```alphacharts
plot(volume.x)
```

<!-- skill: invalid: "math.sin" is a function; call it: math.sin(...) -->
```alphacharts
plot(math.sin)
```

<!-- skill: invalid: unknown name "color.nosuch" -->
```alphacharts
plot(close, color=color.nosuch)
```

<!-- skill: invalid: "not" needs a bool, got series float -->
```alphacharts
plot(not close)
```

<!-- skill: invalid: unary "-" needs a number, got bool -->
```alphacharts
x = -true
plot(close)
```

<!-- skill: invalid: "and" needs bool operands, got series float and series float -->
```alphacharts
plot(close and open)
```

<!-- skill: invalid: cannot compare series float with bool -->
```alphacharts
x = close == true
plot(close)
```

<!-- skill: invalid: strings and colors can only be compared as constants or inputs -->
```alphacharts
c = input.string("a", options=["a"])
plot(close)
x = (close > open ? "a" : "b") == c
```

<!-- skill: invalid: "*" needs numbers, got bool and int (a bool is not a number: use a ternary) -->
```alphacharts
x = true * 2
plot(close)
```

<!-- skill: invalid: the condition of ?: must be bool, got series float -->
```alphacharts
plot(close ? 1 : 2)
```

<!-- skill: invalid: the branches of ?: have different types: int and string -->
```alphacharts
plot(close > open ? 1 : "a")
```

<!-- skill: invalid: only a series can be indexed with [ ], this is int -->
```alphacharts
x = 1
plot(x[1])
```

<!-- skill: invalid: the history offset must be an int, got float -->
```alphacharts
x = close[1.5]
plot(x)
```

<!-- skill: invalid: history [ ] needs a plain series or a top-level variable; a block variable, loop counter or an expression of those has no earlier values. Assign the value to a top-level variable first -->
```alphacharts
var float s = 0
s := s + close
for i = 1 to 3
    t = i + 1
    s := s + t[1]
plot(s)
```

<!-- skill: invalid: the history offset must be between 0 and 1000000, got -1 -->
```alphacharts
x = close[-1]
plot(x)
```

<!-- skill: invalid: positional arguments must come before named ones -->
```alphacharts
plot(close, title="a", 1)
```

<!-- skill: invalid: ta.atr takes at most 1 argument, got 2 -->
```alphacharts
plot(ta.atr(5, 6))
```

<!-- skill: invalid: math.max takes at most 2 arguments, got 3 -->
```alphacharts
plot(math.max(close, open, low))
```

<!-- skill: invalid: plot has no parameter "close" (parameters: series, title, color, linewidth, style, offset, color_down) -->
```alphacharts
plot(close, close=1)
```

<!-- skill: invalid: parameter "title" is given twice -->
```alphacharts
plot(close, title="a", title="b")
```

<!-- skill: invalid: plot needs the argument "series" -->
```alphacharts
plot()
```

<!-- skill: invalid: argument "price" of hline must be a literal or an input, not a series value -->
```alphacharts
hline(close)
```

<!-- skill: invalid: argument "series" of plot must be a number series, got a tuple of 2 values (destructure it: [a, b] = ...) -->
```alphacharts
plot(ta.stoch())
```

<!-- skill: invalid: argument "series" of plotshape must be a value -->
```alphacharts
plotshape(ta.macd(close))
```

<!-- skill: invalid: argument "price" of hline must be a number, got bool -->
```alphacharts
plot(close)
hline(true)
```

<!-- skill: invalid: argument "length" of ta.sma must be an int, got float -->
```alphacharts
plot(ta.sma(close, 1.5))
```

<!-- skill: invalid: argument "title" of plot must be a string, got int -->
```alphacharts
plot(close, 5)
```

<!-- skill: invalid: argument "method" of ta.cmo must be one of "sum", "wilder", got "Wilder" -->
```alphacharts
plot(ta.cmo(close, 9, "Wilder"))
```

<!-- skill: invalid: argument "style" of plot must be one of plot.style_* -->
```alphacharts
plot(close, style=1)
```

<!-- skill: invalid: argument "plot1" of fill must be a plot handle: p = plot(...) -->
```alphacharts
fill(1, 2)
```

<!-- skill: invalid: argument "length" of ta.sma must be between 1 and 5000, got 0 -->
```alphacharts
plot(ta.sma(close, 0))
```

<!-- skill: invalid: only named functions can be called -->
```alphacharts
x = ta.sma(close, 5)(2)
plot(close)
```

<!-- skill: invalid: unknown function "sma"; did you mean ta.sma? -->
```alphacharts
plot(sma(close, 5))
```

<!-- skill: invalid: plot() is only allowed as a statement at the top level of the script -->
```alphacharts
for i = 1 to 10
    plot(close)
```

<!-- skill: invalid: input.* may only be the whole right-hand side of a top-level declaration: name = input.int(...) -->
```alphacharts
plot(input.int(14))
```

<!-- skill: invalid: argument "source" of ta.sma depends on a variable that is declared var, assigned with :=, or is a block variable / loop counter. ta.sma runs over whole columns, so its inputs must be known before the bar is evaluated -->
```alphacharts
var x = 0
x := 1
plot(ta.sma(x, 3))
```

<!-- skill: invalid: ta.change needs a plain series or a top-level variable, not an expression of changing variables -->
```alphacharts
var float s = 0
s := s + close
plot(ta.change(s * 2))
```

<!-- skill: invalid: ta.crossover needs plain series or top-level variables, not expressions of changing variables; assign the value to a variable first -->
```alphacharts
var float s = 0
s := s + close
plot(ta.crossover(s * 2, close) ? 1 : 0)
```

<!-- skill: invalid: ta.bb needs inputs known before the bar is evaluated (no var / := / block variables) -->
```alphacharts
var float s = 0
s := s + close
[a, b, c] = ta.bb(s, 5, 2)
plot(a)
```

<!-- skill: invalid: this must be a string literal -->
```alphacharts
t = close > open ? "a" : "b"
plot(close, t)
```

<!-- skill: invalid: this must be a number literal -->
```alphacharts
plot(close, linewidth=close)
```

<!-- skill: invalid: indicator() may be called only once -->
```alphacharts
indicator("a")
indicator("b")
plot(close)
```

<!-- skill: invalid: overlay must be true or false -->
```alphacharts
indicator("t", overlay=close)
plot(close)
```

<!-- skill: invalid: a color here must be a constant (color.red, #rrggbb, color.new(...)) or an input.color variable -->
```alphacharts
plot(close, color=close > open ? color.green : color.red)
```

<!-- skill: invalid: a script may draw at most 64 plots -->
```alphacharts
plot(close, "p0")
plot(close, "p1")
plot(close, "p2")
plot(close, "p3")
plot(close, "p4")
plot(close, "p5")
plot(close, "p6")
plot(close, "p7")
plot(close, "p8")
plot(close, "p9")
plot(close, "p10")
plot(close, "p11")
plot(close, "p12")
plot(close, "p13")
plot(close, "p14")
plot(close, "p15")
plot(close, "p16")
plot(close, "p17")
plot(close, "p18")
plot(close, "p19")
plot(close, "p20")
plot(close, "p21")
plot(close, "p22")
plot(close, "p23")
plot(close, "p24")
plot(close, "p25")
plot(close, "p26")
plot(close, "p27")
plot(close, "p28")
plot(close, "p29")
plot(close, "p30")
plot(close, "p31")
plot(close, "p32")
plot(close, "p33")
plot(close, "p34")
plot(close, "p35")
plot(close, "p36")
plot(close, "p37")
plot(close, "p38")
plot(close, "p39")
plot(close, "p40")
plot(close, "p41")
plot(close, "p42")
plot(close, "p43")
plot(close, "p44")
plot(close, "p45")
plot(close, "p46")
plot(close, "p47")
plot(close, "p48")
plot(close, "p49")
plot(close, "p50")
plot(close, "p51")
plot(close, "p52")
plot(close, "p53")
plot(close, "p54")
plot(close, "p55")
plot(close, "p56")
plot(close, "p57")
plot(close, "p58")
plot(close, "p59")
plot(close, "p60")
plot(close, "p61")
plot(close, "p62")
plot(close, "p63")
plot(close, "p64")
```

<!-- skill: invalid: color_down must be a constant color -->
```alphacharts
c = input.color(color.red)
plot(close, color_down=c)
```

<!-- skill: invalid: fill needs line plots (not hline, histogram, area or markers) -->
```alphacharts
p = plot(close)
q = plot(open, style=plot.style_histogram)
fill(p, q)
```

<!-- skill: invalid: fill needs two different plots -->
```alphacharts
p = plot(close)
fill(p, p)
```

<!-- skill: invalid: location.absolute needs a number (the price to mark), not a bool -->
```alphacharts
plotshape(close > open, location=location.absolute)
```

<!-- skill: invalid: plotshape marks bars where a bool is true; for a number use location=location.absolute -->
```alphacharts
plotshape(close)
```

<!-- skill: invalid: plotshape needs a bool or a number, got color -->
```alphacharts
plotshape(color.red, location=location.absolute)
```

<!-- skill: invalid: unknown function "nosuch" -->
```alphacharts
plot(nosuch(close))
```

<!-- skill: invalid: options must be a non-empty list of string literals: options=["a", "b"] -->
```alphacharts
x = input.string("a", options=[])
plot(close)
```

<!-- skill: invalid: minval of input.int must be a literal -->
```alphacharts
n = 5
x = input.int(5, minval=close)
plot(close)
```

<!-- skill: invalid: the default of input.source must be one of close, open, high, low, hl2, hlc3, ohlc4, hlcc4 -->
```alphacharts
x = input.source(5)
plot(close)
```

<!-- skill: invalid: step must be positive -->
```alphacharts
x = input.int(5, step=0)
plot(close)
```

<!-- skill: invalid: the default 5 is outside [10, inf] -->
```alphacharts
x = input.int(5, minval=10)
plot(close)
```

<!-- skill: invalid: minval is above maxval -->
```alphacharts
x = input.int(5, minval=10, maxval=2)
plot(close)
```

<!-- skill: invalid: the default "a" is not one of the options -->
```alphacharts
x = input.string("a", options=["b"])
plot(close)
```

<!-- skill: invalid: the script needs 15 columns; the limit is 1 ;; limits={"maxColumns":1} -->
```alphacharts
plot(ta.sma(close, 3))
plot(ta.sma(close, 4))
```

<!-- skill: invalid: execution budget exceeded: more than 2000000 loop steps in one bar -->
```alphacharts
s = 0
for i = 1 to 10000
    for j = 1 to 1000
        s += 1
plot(s)
```

<!-- skill: invalid: loop bounds must be finite and the step non-zero -->
```alphacharts
n = input.int(0)
for i = 1 to 3 by n
    x = i
plot(close)
```

<!-- skill: invalid: this loop would run 100000 times; the limit is 10000 iterations per loop -->
```alphacharts
n = input.int(100000)
s = 0
for i = 1 to n
    s += 1
plot(s)
```

<!-- skill: invalid: the length of ta.sma must be an integer between 1 and 5000, got 25000 -->
```alphacharts
n = input.int(5)
plot(ta.sma(close, n * 5000))
```

<!-- skill: invalid: mult of ta.bb must be a number between 0 and 100, got 1000 -->
```alphacharts
m = input.float(1000)
[a, b, c] = ta.bb(close, 5, m)
plot(a)
```

<!-- skill: invalid: length of ta.cmo must be an integer >= 1 <= 5000, got 25000 -->
```alphacharts
n = input.int(5)
plot(ta.cmo(close, n * 5000))
```

<!-- skill: invalid: start of ta.sar must be a number >= 0 <= 100, got 5000 -->
```alphacharts
m = input.float(5)
plot(ta.sar(m * 1000))
```

<!-- skill: invalid: the history offset must be an integer between 0 and 1000000, got 2000000 -->
```alphacharts
n = input.int(2000000)
plot(close[n])
```

<!-- skill: invalid: a string or color is not a number -->
```alphacharts
s = close > open ? "up" : "down"
plot(close)
```

<!-- skill: invalid: the script is 22 characters; the limit is 10 ;; limits={"maxSourceChars":10} -->
```alphacharts
plot(close)
plot(open)
```

<!-- skill: invalid: the script draws nothing: add plot(...) -->
```alphacharts

```

<!-- skill: invalid: too many errors; stopped after 50 -->
```alphacharts
y0 = nosuch
y1 = nosuch
y2 = nosuch
y3 = nosuch
y4 = nosuch
y5 = nosuch
y6 = nosuch
y7 = nosuch
y8 = nosuch
y9 = nosuch
y10 = nosuch
y11 = nosuch
y12 = nosuch
y13 = nosuch
y14 = nosuch
y15 = nosuch
y16 = nosuch
y17 = nosuch
y18 = nosuch
y19 = nosuch
y20 = nosuch
y21 = nosuch
y22 = nosuch
y23 = nosuch
y24 = nosuch
y25 = nosuch
y26 = nosuch
y27 = nosuch
y28 = nosuch
y29 = nosuch
y30 = nosuch
y31 = nosuch
y32 = nosuch
y33 = nosuch
y34 = nosuch
y35 = nosuch
y36 = nosuch
y37 = nosuch
y38 = nosuch
y39 = nosuch
y40 = nosuch
y41 = nosuch
y42 = nosuch
y43 = nosuch
y44 = nosuch
y45 = nosuch
y46 = nosuch
y47 = nosuch
y48 = nosuch
y49 = nosuch
y50 = nosuch
y51 = nosuch
y52 = nosuch
y53 = nosuch
y54 = nosuch
plot(close)
```
