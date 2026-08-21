document.addEventListener("DOMContentLoaded", () => {
  let selectedPlan = "free_trial";
  const customSkills = {};
  const planNames = { free_trial: "Free Trial (3 Days)", pro: "AI Workforce Pro", starter: "AI Workforce Pro", growth: "AI Workforce Pro", enterprise: "AI Workforce Pro" };
  const planTotals = { free_trial: "Free for 3 days", pro: "₹5 / month", starter: "₹5 / month", growth: "₹5 / month", enterprise: "₹5 / month" };
  const errorDiv = document.getElementById("onboarding-error");

  const showError = (message) => {
    if (!errorDiv) return;
    errorDiv.textContent = message;
    errorDiv.style.display = "block";
    errorDiv.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const clearError = () => {
    if (errorDiv) {
      errorDiv.textContent = "";
      errorDiv.style.display = "none";
    }
  };

  const postJson = async (url, body = {}, timeoutMs = 15000) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      clearTimeout(timer);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Something went wrong. Please try again.");
      return data;
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        throw new Error("Request timed out. Please check your connection and try again.");
      }
      throw err;
    }
  };

  function getMaxEmployees(plan) {
    const selectedCard = document.querySelector(`.plan-card[data-tier="${plan}"]`);
    if (selectedCard && selectedCard.dataset.maxEmployees) {
      return Number(selectedCard.dataset.maxEmployees);
    }
    return 4;
  }

  function goToStep(step) {
    clearError();
    document.querySelectorAll(".wizard-step").forEach((element) => {
      element.style.display = "none";
    });
    const targetStep = document.getElementById(`step-${step}`);
    if (targetStep) {
      targetStep.style.display = "block";
      targetStep.scrollIntoView({ behavior: "smooth", block: "start" });
    }

    for (let index = 1; index <= 4; index += 1) {
      const dot = document.getElementById(`step-dot-${index}`);
      if (!dot) continue;
      dot.classList.toggle("active", index === step);
      dot.classList.toggle("completed", index < step);
    }

    if (step === 3) {
      updateEmployeeSelectionNotice();
    }
  }

  function syncEmployeeCardStyles() {
    document.querySelectorAll(".emp-card").forEach((card) => {
      const chk = card.querySelector(".emp-checkbox");
      if (chk) {
        card.classList.toggle("selected", chk.checked);
      }
    });
  }

  function updateEmployeeSelectionNotice() {
    const maxAllowed = getMaxEmployees(selectedPlan);
    const checked = Array.from(document.querySelectorAll(".emp-checkbox:checked"));
    const noticeEl = document.getElementById("emp-selection-notice");
    if (!noticeEl) return;

    if (checked.length > maxAllowed) {
      noticeEl.style.display = "block";
      noticeEl.style.borderColor = "rgba(255, 107, 107, 0.4)";
      noticeEl.style.background = "rgba(255, 107, 107, 0.1)";
      noticeEl.style.color = "#ff9e9e";
      noticeEl.innerHTML = `⚠️ <strong>${planNames[selectedPlan] || selectedPlan}</strong> includes up to <strong>${maxAllowed} AI employees</strong>. You have <strong>${checked.length} selected</strong>. Please uncheck ${checked.length - maxAllowed} employee(s) or <a href="#" id="upgrade-plan-link" style="color:#7ee8ff; text-decoration:underline;">upgrade plan in Step 2</a>.`;

      const link = document.getElementById("upgrade-plan-link");
      if (link) {
        link.addEventListener("click", (e) => {
          e.preventDefault();
          goToStep(2);
        });
      }
    } else {
      noticeEl.style.display = "block";
      noticeEl.style.borderColor = "rgba(126, 232, 255, 0.25)";
      noticeEl.style.background = "rgba(126, 232, 255, 0.08)";
      noticeEl.style.color = "var(--chalk)";
      noticeEl.innerHTML = `✓ <strong>${checked.length} of ${maxAllowed}</strong> AI employees selected for your ${planNames[selectedPlan] || selectedPlan}.`;
    }
  }

  function applyPlanEmployeeLimit() {
    const maxEmployees = getMaxEmployees(selectedPlan);
    const checked = Array.from(document.querySelectorAll(".emp-checkbox:checked"));
    if (checked.length > maxEmployees) {
      checked.slice(maxEmployees).forEach((checkbox) => {
        checkbox.checked = false;
      });
    }
    syncEmployeeCardStyles();
    updateEmployeeSelectionNotice();
  }

  function updateFinalStepLabel() {
    const label = document.querySelector("#step-dot-4 .step-name");
    if (label) label.textContent = selectedPlan === "free_trial" ? "Activate" : "Payment";
  }

  // Step 1 handler
  const step1Btn = document.getElementById("step1-next");
  if (step1Btn) {
    step1Btn.addEventListener("click", async () => {
      const companyName = document.getElementById("company_name")?.value.trim();
      if (!companyName) return showError("Please enter your company name.");
      const userRole = document.getElementById("user_role")?.value.trim() || "";
      const businessGoals = document.getElementById("business_goals")?.value.trim() || "";
      const workspaceGuidelines = document.getElementById("workspace_guidelines")?.value.trim() || "";

      step1Btn.disabled = true;
      step1Btn.textContent = "Saving workspace...";
      try {
        await postJson("/api/onboarding/save-company", {
          company_name: companyName,
          user_role: userRole,
          industry: document.getElementById("industry")?.value || "",
          team_size: document.getElementById("team_size")?.value || "",
          business_goals: businessGoals,
          workspace_guidelines: workspaceGuidelines
        });
        goToStep(2);
      } catch (error) {
        showError(error.message);
      } finally {
        step1Btn.disabled = false;
        step1Btn.textContent = "Continue →";
      }
    });
  }

  // Step 2 plan card handlers
  document.querySelectorAll(".plan-card").forEach((card) => {
    card.addEventListener("click", () => {
      document.querySelectorAll(".plan-card").forEach((item) => item.classList.remove("selected"));
      card.classList.add("selected");
      selectedPlan = card.dataset.tier || "free_trial";
      applyPlanEmployeeLimit();
      updateFinalStepLabel();
    });
  });

  const trialCard = document.querySelector('.plan-card[data-tier="free_trial"]');
  if (trialCard) {
    trialCard.classList.add("selected");
    applyPlanEmployeeLimit();
    updateFinalStepLabel();
  }

  const step2Back = document.getElementById("step2-back");
  if (step2Back) step2Back.addEventListener("click", () => goToStep(1));

  const step2Next = document.getElementById("step2-next");
  if (step2Next) {
    step2Next.addEventListener("click", async () => {
      step2Next.disabled = true;
      step2Next.textContent = "Saving plan...";
      try {
        await postJson("/api/onboarding/select-plan", { tier: selectedPlan });
        goToStep(3);
      } catch (error) {
        showError(error.message);
      } finally {
        step2Next.disabled = false;
        step2Next.textContent = "Continue →";
      }
    });
  }

  // Employee selection listeners
  document.querySelectorAll(".emp-checkbox").forEach((chk) => {
    chk.addEventListener("change", () => {
      syncEmployeeCardStyles();
      updateEmployeeSelectionNotice();
    });
  });

  document.querySelectorAll(".emp-card").forEach((card) => {
    card.addEventListener("click", (e) => {
      if (e.target.closest(".new-skill-input") || e.target.closest(".emp-checkbox-label") || e.target.closest(".chip")) return;
      const chk = card.querySelector(".emp-checkbox");
      if (chk) {
        chk.checked = !chk.checked;
        syncEmployeeCardStyles();
        updateEmployeeSelectionNotice();
      }
    });
  });

  document.querySelectorAll(".new-skill-input").forEach((input) => {
    input.addEventListener("keypress", (event) => {
      if (event.key !== "Enter" || !input.value.trim()) return;
      event.preventDefault();
      const employeeId = input.dataset.empId;
      const skill = input.value.trim();
      if (!customSkills[employeeId]) {
        customSkills[employeeId] = Array.from(document.querySelectorAll(`#skills-${employeeId} .chip`)).map((chip) => chip.textContent.trim());
      }
      customSkills[employeeId].push(skill);
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = skill;
      const container = document.getElementById(`skills-${employeeId}`);
      if (container) container.appendChild(chip);
      input.value = "";
    });
  });

  // Step 3 handlers
  const step3Back = document.getElementById("step3-back");
  if (step3Back) step3Back.addEventListener("click", () => goToStep(2));

  const step3Next = document.getElementById("step3-next");
  if (step3Next) {
    step3Next.addEventListener("click", async () => {
      const employees = Array.from(document.querySelectorAll(".emp-checkbox:checked")).map((checkbox) => checkbox.value);
      if (!employees.length) return showError("Please select at least one AI employee.");

      const maxAllowed = getMaxEmployees(selectedPlan);
      if (employees.length > maxAllowed) {
        return showError(`${planNames[selectedPlan] || selectedPlan} allows up to ${maxAllowed} AI employees. Please uncheck ${employees.length - maxAllowed} employee(s) or choose a higher plan in Step 2.`);
      }

      step3Next.disabled = true;
      step3Next.textContent = "Saving crew...";
      clearError();

      try {
        await postJson("/api/onboarding/select-employees", { employee_ids: employees, custom_skills: customSkills });
        
        const sumPlan = document.getElementById("sum-plan-name");
        if (sumPlan) sumPlan.textContent = planNames[selectedPlan] || selectedPlan;
        const sumCount = document.getElementById("sum-emp-count");
        if (sumCount) sumCount.textContent = `${employees.length} Employee${employees.length === 1 ? "" : "s"} Selected`;
        const sumTotal = document.getElementById("sum-total");
        if (sumTotal) sumTotal.textContent = planTotals[selectedPlan] || "";

        if (selectedPlan === "free_trial") {
          step3Next.textContent = "Activating trial...";
          await postJson("/api/onboarding/complete");
          const msgEl = document.getElementById("activation-message");
          if (msgEl) msgEl.textContent = "Your 3-day free trial is live. Your AI team is ready for its first assignment — upgrade when you are ready for more operations.";
          goToStep(5);
          return;
        }
        goToStep(4);
      } catch (error) {
        showError(error.message);
      } finally {
        step3Next.disabled = false;
        step3Next.textContent = "Continue →";
      }
    });
  }

  // Step 4 handlers
  const step4Back = document.getElementById("step4-back");
  if (step4Back) step4Back.addEventListener("click", () => goToStep(3));

  const payBtn = document.getElementById("pay-now-btn");
  if (payBtn) {
    payBtn.addEventListener("click", async () => {
      clearError();
      payBtn.disabled = true;
      payBtn.textContent = "Creating order…";
      try {
        const order = await postJson("/api/create-order", { tier: selectedPlan });

        const verifyAndComplete = async (paymentDetails = {}) => {
          if (!paymentDetails.razorpay_order_id || !paymentDetails.razorpay_payment_id || !paymentDetails.razorpay_signature) {
            showError("Razorpay did not return a verifiable payment. No changes were made to your workspace.");
            payBtn.disabled = false;
            payBtn.textContent = "⚡ Pay & Activate";
            return;
          }
          payBtn.textContent = "Verifying payment…";
          try {
            await postJson("/api/verify-payment", {
              razorpay_order_id: paymentDetails.razorpay_order_id,
              razorpay_payment_id: paymentDetails.razorpay_payment_id,
              razorpay_signature: paymentDetails.razorpay_signature
            });
            await postJson("/api/onboarding/complete");
            goToStep(5);
          } catch (error) {
            showError(error.message);
            payBtn.disabled = false;
            payBtn.textContent = "⚡ Pay & Activate";
          }
        };

        if (typeof Razorpay !== "undefined") {
          try {
            const checkout = new Razorpay({
              key: order.key_id || window.RAZORPAY_KEY,
              amount: order.amount,
              currency: order.currency || "INR",
              name: "Caveworkers OS",
              description: `${planNames[selectedPlan] || selectedPlan} subscription`,
              order_id: order.order_id || order.id,
              handler: verifyAndComplete,
              theme: { color: "#c5f36a" },
              modal: {
                ondismiss: function () {
                  payBtn.disabled = false;
                  payBtn.textContent = "⚡ Pay & Activate";
                  showError("Payment modal was closed. You can click 'Pay & Activate' to try again.");
                }
              }
            });
            checkout.on("payment.failed", function (resp) {
              console.warn("Razorpay payment failed:", resp);
              showError(resp?.error?.description || "Payment was declined. No changes were made to your workspace.");
              payBtn.disabled = false;
              payBtn.textContent = "⚡ Pay & Activate";
            });
            checkout.open();
          } catch (rErr) {
            console.warn("Razorpay popup error:", rErr);
            showError("The payment window could not be opened. Please try again.");
            payBtn.disabled = false;
            payBtn.textContent = "⚡ Pay & Activate";
          }
        } else {
          throw new Error("Payment checkout is unavailable. Please try again later.");
        }
      } catch (error) {
        showError(error.message);
        payBtn.disabled = false;
        payBtn.textContent = "⚡ Pay & Activate";
      }
    });
  }

  // Initialize selection notice
  updateEmployeeSelectionNotice();
});
