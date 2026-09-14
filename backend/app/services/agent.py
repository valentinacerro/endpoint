"""How this app introduces itself to the free services it depends on.

One constant, because the alternative is finding out one service at a
time. Photon started answering 403 to `python-httpx/0.27` — its default
agent — and the geocoder went dead with no deploy, no error and no sign
except every search returning nothing. Anything that looks like a real
client is accepted; saying who we actually are is the polite version, and
gives an operator someone to contact instead of a block.
"""

USER_AGENT = "endpoint/1.0 (personal travel planner; +https://github.com/valentinacerro/endpoint)"

#: Ready to spread into an httpx call.
HEADERS = {"User-Agent": USER_AGENT}
