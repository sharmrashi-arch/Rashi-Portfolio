(function () {
  "use strict";

  var isTouch = window.matchMedia("(hover: none), (pointer: coarse)").matches;
  var prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ============ Navbar scroll state ============ */
  var navbar = document.getElementById("navbar");
  function onScroll() {
    if (window.scrollY > 50) {
      navbar.classList.add("scrolled");
    } else {
      navbar.classList.remove("scrolled");
    }
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ============ Mobile menu ============ */
  var menuToggle = document.getElementById("menu-toggle");
  var mobileMenu = document.getElementById("mobile-menu");

  function closeMenu() {
    menuToggle.classList.remove("open");
    menuToggle.setAttribute("aria-expanded", "false");
    mobileMenu.classList.remove("open");
  }

  menuToggle.addEventListener("click", function () {
    var open = mobileMenu.classList.toggle("open");
    menuToggle.classList.toggle("open", open);
    menuToggle.setAttribute("aria-expanded", String(open));
  });

  mobileMenu.querySelectorAll("a").forEach(function (a) {
    a.addEventListener("click", closeMenu);
  });

  /* ============ Custom cursor ============ */
  var cursor = document.getElementById("cursor");
  var cursorDot = document.getElementById("cursor-dot");

  if (!isTouch) {
    var cx = window.innerWidth / 2;
    var cy = window.innerHeight / 2;
    var mx = cx;
    var my = cy;

    window.addEventListener("mousemove", function (e) {
      mx = e.clientX;
      my = e.clientY;
      cursorDot.style.transform = "translate(" + mx + "px," + my + "px) translate(-50%,-50%)";
    });

    (function follow() {
      cx += (mx - cx) * 0.18;
      cy += (my - cy) * 0.18;
      cursor.style.transform = "translate(" + cx + "px," + cy + "px) translate(-50%,-50%)";
      requestAnimationFrame(follow);
    })();

    var hoverTargets = document.querySelectorAll("a, button, input, textarea, .skill-card, .project-card");
    hoverTargets.forEach(function (el) {
      el.addEventListener("mouseenter", function () {
        cursor.style.transform += " scale(1.6)";
        cursor.style.borderColor = "#7ab0ff";
      });
      el.addEventListener("mouseleave", function () {
        cursor.style.transform = cursor.style.transform.replace(" scale(1.6)", "");
        cursor.style.borderColor = "";
      });
    });
  }

  /* ============ Particles ============ */
  var canvas = document.getElementById("particles");
  var ctx = canvas.getContext("2d");
  var particles = [];
  var pCount = Math.min(70, Math.floor(window.innerWidth / 22));

  function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
  }
  window.addEventListener("resize", resizeCanvas);
  resizeCanvas();

  if (prefersReduced) {
    canvas.style.display = "none";
  } else {
    function spawnParticle(first) {
      var speed = 0.15 + Math.random() * 0.35;
      return {
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: first ? 2.2 : 1 + Math.random() * 1.8,
        vx: (Math.random() - 0.5) * speed,
        vy: (Math.random() - 0.5) * speed
      };
    }

    for (var i = 0; i < pCount; i++) {
      particles.push(spawnParticle(true));
    }

    (function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.x += p.vx;
        p.y += p.vy;

        if (p.x < -10) p.x = canvas.width + 10;
        if (p.x > canvas.width + 10) p.x = -10;
        if (p.y < -10) p.y = canvas.height + 10;
        if (p.y > canvas.height + 10) p.y = -10;

        var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, "rgba(122,176,255,0.55)");
        g.addColorStop(1, "rgba(122,176,255,0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
      }

      requestAnimationFrame(draw);
    })();
  }

  /* ============ Typewriter ============ */
  var typeEl = document.getElementById("typewriter");
  var phrases = ["Rashi Sharma", "a Digital Marketer", "an AI Enthusiast", "a Web Developer", "a Game Creator"];
  var pi = 0;
  var ci = 0;
  var deleting = false;
  var typeSpeed = 70;
  var deleteSpeed = 38;
  var pause = 1400;

  function type() {
    var current = phrases[pi];
    if (!deleting) {
      typeEl.textContent = current.slice(0, ci + 1);
      ci++;
      if (ci === current.length) {
        deleting = true;
        setTimeout(type, pause);
        return;
      }
      setTimeout(type, typeSpeed);
    } else {
      typeEl.textContent = current.slice(0, ci - 1);
      ci--;
      if (ci === 0) {
        deleting = false;
        pi = (pi + 1) % phrases.length;
        setTimeout(type, 420);
        return;
      }
      setTimeout(type, deleteSpeed);
    }
  }

  if (prefersReduced) {
    typeEl.textContent = phrases[0];
  } else {
    setTimeout(type, 600);
  }

  /* ============ Reveal on scroll ============ */
  var revealEls = document.querySelectorAll(".reveal:not(.skill-card)");
  var revealObserver = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("visible");
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );
  revealEls.forEach(function (el) {
    revealObserver.observe(el);
  });

  var skillsGrid = document.querySelector(".skills-grid");
  if (skillsGrid) {
    var skillCards = skillsGrid.querySelectorAll(".skill-card");
    var skillObserver = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            skillCards.forEach(function (card) {
              card.classList.add("visible");
            });
            skillObserver.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.2 }
    );
    skillObserver.observe(skillsGrid);
  }

  /* ============ Project thumb scroll parallax ============ */
  var thumbImgs = document.querySelectorAll(".project-thumb img");

  function parallaxThumbs() {
    var vh = window.innerHeight || 1;
    thumbImgs.forEach(function (img) {
      var rect = img.parentElement.getBoundingClientRect();
      var center = rect.top + rect.height / 2;
      var dist = center - vh / 2;
      var norm = Math.max(-1, Math.min(1, dist / (vh / 2)));
      img.style.transform = "scale(1.2) translateY(" + norm * 14 + "px)";
    });
  }

  if (thumbImgs.length && !prefersReduced) {
    var parallaxTicking = false;
    window.addEventListener(
      "scroll",
      function () {
        if (!parallaxTicking) {
          requestAnimationFrame(function () {
            parallaxThumbs();
            parallaxTicking = false;
          });
          parallaxTicking = true;
        }
      },
      { passive: true }
    );
    parallaxThumbs();
  }

  /* ============ Stats counters ============ */
  var statEls = document.querySelectorAll(".stat-number");
  var counted = new WeakSet();

  function animateCounter(el) {
    var target = parseInt(el.getAttribute("data-target"), 10) || 0;
    var duration = 1600;
    var start = null;

    function step(ts) {
      if (!start) start = ts;
      var progress = Math.min((ts - start) / duration, 1);
      var eased = 1 - Math.pow(1 - progress, 3);
      el.textContent = Math.round(eased * target);
      if (progress < 1) {
        requestAnimationFrame(step);
      }
    }
    requestAnimationFrame(step);
  }

  var statObserver = new IntersectionObserver(
    function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting && !counted.has(entry.target)) {
          counted.add(entry.target);
          animateCounter(entry.target);
          statObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.5 }
  );
  statEls.forEach(function (el) {
    statObserver.observe(el);
  });

  /* ============ Vision rotator ============ */
  var slides = document.querySelectorAll(".vision-slide");
  var currentSlide = 0;

  function nextSlide() {
    slides[currentSlide].classList.remove("active");
    currentSlide = (currentSlide + 1) % slides.length;
    slides[currentSlide].classList.add("active");
  }

  if (slides.length > 1 && !prefersReduced) {
    setInterval(nextSlide, 3800);
  }

  /* ============ Contact form ============ */
  var form = document.getElementById("contact-form");
  var statusEl = document.getElementById("form-status");
  var submitBtn = document.getElementById("form-submit");

  form.addEventListener("submit", async function (e) {
    e.preventDefault();

    var name = document.getElementById("name").value.trim();
    var email = document.getElementById("email").value.trim();
    var message = document.getElementById("message").value.trim();

    if (!name || !email || !message) {
      statusEl.textContent = "Please fill in all the fields.";
      statusEl.style.color = "#c0392b";
      return;
    }
    if (!/^\S+@\S+\.\S+$/.test(email)) {
      statusEl.textContent = "Please enter a valid email address.";
      statusEl.style.color = "#c0392b";
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending...";
    statusEl.textContent = "";

    try {
      var res = await fetch("/api/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name, email: email, message: message })
      });
      var data = await res.json().catch(function () {
        return {};
      });

      if (data.ok) {
        statusEl.textContent = "Thank you " + name + "! Your message has been sent to Rashi.";
        statusEl.style.color = "#2e7d32";
        form.reset();
      } else {
        statusEl.textContent = data.error || "Something went wrong. Please try again.";
        statusEl.style.color = "#c0392b";
      }
    } catch (err) {
      statusEl.textContent = "Could not reach the server. Start the Node server and try again.";
      statusEl.style.color = "#c0392b";
    }

    submitBtn.disabled = false;
    submitBtn.textContent = "Send Message";
  });
})();