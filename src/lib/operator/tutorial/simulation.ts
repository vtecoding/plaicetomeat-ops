import type { SimulatedState, TutorialEvent } from "./types";

export function createInitialSimulation(): SimulatedState {
  return {
    shopOpen: false,
    openingClean: false,
    openingTemperature: "",
    openingFloat: "",
    sale: { product: "", weight: "", payment: "", complete: false },
    delivery: { started: false, product: "", weight: "", expiry: "", evidence: false, complete: false },
    waste: { product: "", weight: "", reason: "", complete: false },
    till: { counted: "", confirmed: false },
    helpOpened: false,
    close: { clean: false, temperature: "", till: "", complete: false },
  };
}

export function cloneSimulation(state: SimulatedState): SimulatedState {
  return structuredClone(state);
}

export function applyTutorialEvent(state: SimulatedState, event: TutorialEvent): SimulatedState {
  const next = cloneSimulation(state);
  const value = event.value === undefined ? "" : String(event.value);

  switch (event.name) {
    case "operator.open.checklist_confirmed": next.openingClean = true; break;
    case "operator.temperature.entered": next.openingTemperature = value; break;
    case "operator.till.float_entered": next.openingFloat = value; break;
    case "operator.shop.opened": next.shopOpen = true; break;
    case "operator.serve.product_added": next.sale.product = value; break;
    case "operator.serve.weight_entered": next.sale.weight = value; break;
    case "operator.serve.cash_selected": next.sale.payment = "cash"; break;
    case "operator.serve.confirmed": next.sale.complete = true; break;
    case "operator.stock.delivery_selected": next.delivery.started = true; break;
    case "operator.stock.product_selected": next.delivery.product = value; break;
    case "operator.stock.weight_entered": next.delivery.weight = value; break;
    case "operator.stock.expiry_entered": next.delivery.expiry = value; break;
    case "operator.stock.evidence_simulated": next.delivery.evidence = true; break;
    case "operator.stock.delivery_confirmed": next.delivery.complete = true; break;
    case "operator.waste.product_selected": next.waste.product = value; break;
    case "operator.waste.weight_entered": next.waste.weight = value; break;
    case "operator.waste.reason_selected": next.waste.reason = value; break;
    case "operator.waste.confirmed": next.waste.complete = true; break;
    case "operator.till.count_entered": next.till.counted = value; break;
    case "operator.till.count_confirmed": next.till.confirmed = true; break;
    case "operator.help.opened": next.helpOpened = true; break;
    case "operator.close.checklist_confirmed": next.close.clean = true; break;
    case "operator.close.temperature_entered": next.close.temperature = value; break;
    case "operator.close.till_entered": next.close.till = value; break;
    case "operator.shop.closed": next.close.complete = true; next.shopOpen = false; break;
  }

  return next;
}
