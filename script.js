const menuToggle = document.querySelector(".menu-toggle");
const nav = document.querySelector(".nav");

if (menuToggle && nav) {
  menuToggle.addEventListener("click", () => {
    const isOpen = nav.classList.toggle("is-open");
    menuToggle.setAttribute("aria-expanded", String(isOpen));
  });

  nav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => {
      nav.classList.remove("is-open");
      menuToggle.setAttribute("aria-expanded", "false");
    });
  });
}

const revealItems = document.querySelectorAll(".reveal");

if ("IntersectionObserver" in window) {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.18 }
  );

  revealItems.forEach((item) => observer.observe(item));
} else {
  revealItems.forEach((item) => item.classList.add("is-visible"));
}

const estimateForm = document.getElementById("estimate-form");
const formStatus = document.getElementById("form-status");

if (estimateForm && formStatus) {
  estimateForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!estimateForm.checkValidity()) {
      formStatus.textContent = "Please complete each field before sending project details.";
      return;
    }

    const formData = new FormData(estimateForm);
    const payload = {
      name: formData.get("name"),
      email: formData.get("email"),
      phone: formData.get("phone"),
      city: formData.get("city"),
      address: formData.get("address"),
      projectDate: formData.get("projectDate"),
      projectTime: formData.get("projectTime"),
      details: formData.get("details"),
    };

    formStatus.textContent = "Submitting your request...";

    try {
      const response = await fetch("/api/requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error("There was a problem sending your request.");
      }

      const data = await response.json();
      formStatus.textContent = `Thanks, ${data.request.name}. Your request for ${data.request.address}, ${data.request.city} on ${data.request.projectDate} at ${data.request.projectTime} was submitted successfully.`;
      estimateForm.reset();
    } catch (error) {
      formStatus.textContent = error.message;
    }
  });
}
