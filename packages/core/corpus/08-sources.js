// external sources
s0.initCam(0)
s1.initImage('https://example.com/picture.png')
s2.initVideo("https://example.com/clip.mp4")
s3.initScreen()
s3.clear()

src(s0).mult(src(s1), 0.5).out(o0)
src(s2).diff(src(s3)).out(o1)
render(o0)
