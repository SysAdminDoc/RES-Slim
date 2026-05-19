/* @flow */

import { getFeatureToggleKey, getSettingDefault } from '../settings/schema';
import { createFeatureContext } from './featureContext';

function noop() {
	return undefined;
}

function isEnabledBySettings(feature, settings = {}) {
	const toggleKey = getFeatureToggleKey(feature.id);
	if (!toggleKey) return feature.defaultEnabled !== false;
	if (Object.hasOwn(settings, toggleKey)) return settings[toggleKey] !== false;
	return getSettingDefault(toggleKey) !== false;
}

function normalizeDestroy(result) {
	if (typeof result === 'function') return result;
	if (result && typeof result.destroy === 'function') return () => result.destroy();
	return noop;
}

export function createFeatureRegistry(services = {}) {
	const features = new Map();
	const running = new Map();
	const settings = services.settings || {};

	function reportError(feature, stage, error) {
		const logger = services.logger || console;
		logger.error(`Error in feature ${feature.id} during ${stage}`, error);
		if (services.toast) {
			services.toast({
				tone: 'error',
				message: `${feature.title || feature.id} failed during ${stage}.`,
			});
		}
	}

	return {
		register(feature) {
			if (!feature || !feature.id) throw new TypeError('Feature definitions require an id');
			if (typeof feature.init !== 'function') throw new TypeError(`Feature ${feature.id} requires init()`);
			if (features.has(feature.id)) throw new Error(`Feature ${feature.id} is already registered`);
			features.set(feature.id, {
				...feature,
				defaultEnabled: feature.defaultEnabled !== false,
			});
			return feature.id;
		},

		registerAll(featureList) {
			for (const feature of featureList) this.register(feature);
			return this;
		},

		get(featureId) {
			return features.get(featureId);
		},

		all() {
			return Array.from(features.values());
		},

		isRunning(featureId) {
			return running.has(featureId);
		},

		isEnabled(featureId) {
			const feature = features.get(featureId);
			if (!feature) throw new Error(`Unknown feature: ${featureId}`);
			return isEnabledBySettings(feature, settings);
		},

		async initFeature(featureId) {
			const feature = features.get(featureId);
			if (!feature) throw new Error(`Unknown feature: ${featureId}`);
			if (running.has(featureId)) return running.get(featureId).ctx;
			if (!isEnabledBySettings(feature, settings)) return null;

			const ctx = createFeatureContext(feature, services);
			try {
				const destroy = normalizeDestroy(await feature.init(ctx));
				running.set(featureId, { feature, ctx, destroy });
				return ctx;
			} catch (error) {
				ctx.destroy();
				reportError(feature, 'init', error);
				return null;
			}
		},

		async initEnabled() {
			await Promise.all(Array.from(features.values()).map(feature => this.initFeature(feature.id)));
			return this;
		},

		async destroyFeature(featureId) {
			const state = running.get(featureId);
			if (!state) return;
			running.delete(featureId);
			try {
				await state.destroy();
				if (typeof state.feature.destroy === 'function') await state.feature.destroy(state.ctx);
			} catch (error) {
				reportError(state.feature, 'destroy', error);
			} finally {
				state.ctx.destroy();
			}
		},

		async destroyAll() {
			await Array.from(running.keys()).reverse().reduce(
				(promise, featureId) => promise.then(() => this.destroyFeature(featureId)),
				Promise.resolve(),
			);
		},

		async applySetting(key, value) {
			const feature = this.all().find(candidate => getFeatureToggleKey(candidate.id) === key);
			if (!feature) return false;
			settings[key] = value;
			if (value === false) {
				await this.destroyFeature(feature.id);
			} else {
				await this.initFeature(feature.id);
			}
			return true;
		},
	};
}
