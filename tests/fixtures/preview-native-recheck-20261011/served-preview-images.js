/** Paged.js tolerates image load failures; a printable preview must not. */
export function waitForPreviewImages(root, signal, timeoutMs = 15e3) {
	if (signal.aborted) return Promise.reject(new DOMException("Preview closed.", "AbortError"));
	const images = Array.from(root.querySelectorAll("img"));
	if (!images.length) return Promise.resolve();
	return new Promise((resolve, reject) => {
		const pending = new Set(images);
		const cleanups = [];
		const document = root.ownerDocument;
		let settled = false;
		let remaining = timeoutMs;
		let visibleSince = null;
		let timer;
		const pause = () => {
			if (timer !== undefined) clearTimeout(timer);
			timer = undefined;
			if (visibleSince !== null) remaining = Math.max(0, remaining - (performance.now() - visibleSince));
			visibleSince = null;
		};
		const finish = (error) => {
			if (settled) return;
			settled = true;
			pause();
			signal.removeEventListener("abort", abort);
			document.removeEventListener("visibilitychange", visibility);
			cleanups.forEach((cleanup) => cleanup());
			if (error) reject(error);
			else resolve();
		};
		const abort = () => finish(new DOMException("Preview closed.", "AbortError"));
		// Match the outer preview's visible-time budget. Background tabs can defer
		// image loading; returning must resume the unused budget, not reset it.
		const resume = () => {
			if (settled || document.hidden || visibleSince !== null) return;
			visibleSince = performance.now();
			timer = setTimeout(() => {
				pause();
				if (!document.hidden) finish(new Error("An image is taking too long to load. Return to editing and check the images before printing."));
			}, remaining);
		};
		const visibility = () => {
			if (document.hidden) pause();
			else resume();
		};
		signal.addEventListener("abort", abort, { once: true });
		document.addEventListener("visibilitychange", visibility);
		resume();
		for (const [index, image] of images.entries()) {
			const failed = () => finish(new Error(`Image ${index + 1} could not be loaded. Return to editing and replace it before printing.`));
			const loaded = () => {
				if (!image.naturalWidth || !image.naturalHeight) {
					failed();
					return;
				}
				pending.delete(image);
				if (!pending.size) finish();
			};
			image.addEventListener("load", loaded);
			image.addEventListener("error", failed);
			cleanups.push(() => {
				image.removeEventListener("load", loaded);
				image.removeEventListener("error", failed);
			});
			if (image.complete) loaded();
			if (settled) break;
		}
	});
}

//# sourceMappingURL=data:application/json;base64,eyJtYXBwaW5ncyI6IjtBQUNBLE9BQU8sU0FBUyxxQkFBcUIsTUFBbUIsUUFBcUIsWUFBWSxNQUF1QjtDQUM5RyxJQUFJLE9BQU8sU0FBUyxPQUFPLFFBQVEsT0FBTyxJQUFJLGFBQWEsbUJBQW1CLFlBQVksQ0FBQztDQUMzRixNQUFNLFNBQVMsTUFBTSxLQUFLLEtBQUssaUJBQWlCLEtBQUssQ0FBQztDQUN0RCxJQUFJLENBQUMsT0FBTyxRQUFRLE9BQU8sUUFBUSxRQUFRO0NBQzNDLE9BQU8sSUFBSSxTQUFTLFNBQVMsV0FBVztFQUN0QyxNQUFNLFVBQVUsSUFBSSxJQUFJLE1BQU07RUFDOUIsTUFBTSxXQUEyQixDQUFDO0VBQ2xDLE1BQU0sV0FBVyxLQUFLO0VBQ3RCLElBQUksVUFBVTtFQUNkLElBQUksWUFBWTtFQUNoQixJQUFJLGVBQThCO0VBQ2xDLElBQUk7RUFDSixNQUFNLGNBQWM7R0FDbEIsSUFBSSxVQUFVLFdBQVcsYUFBYSxLQUFLO0dBQzNDLFFBQVE7R0FDUixJQUFJLGlCQUFpQixNQUFNLFlBQVksS0FBSyxJQUFJLEdBQUcsYUFBYSxZQUFZLElBQUksSUFBSSxhQUFhO0dBQ2pHLGVBQWU7RUFDakI7RUFDQSxNQUFNLFVBQVUsVUFBa0I7R0FDaEMsSUFBSSxTQUFTO0dBQ2IsVUFBVTtHQUFNLE1BQU07R0FDdEIsT0FBTyxvQkFBb0IsU0FBUyxLQUFLO0dBQ3pDLFNBQVMsb0JBQW9CLG9CQUFvQixVQUFVO0dBQzNELFNBQVMsU0FBUSxZQUFXLFFBQVEsQ0FBQztHQUNyQyxJQUFJLE9BQU8sT0FBTyxLQUFLO1FBQVEsUUFBUTtFQUN6QztFQUNBLE1BQU0sY0FBYyxPQUFPLElBQUksYUFBYSxtQkFBbUIsWUFBWSxDQUFDOzs7RUFHNUUsTUFBTSxlQUFlO0dBQ25CLElBQUksV0FBVyxTQUFTLFVBQVUsaUJBQWlCLE1BQU07R0FDekQsZUFBZSxZQUFZLElBQUk7R0FDL0IsUUFBUSxpQkFBaUI7SUFDdkIsTUFBTTtJQUNOLElBQUksQ0FBQyxTQUFTLFFBQVEsT0FBTyxJQUFJLE1BQU0sOEZBQThGLENBQUM7R0FDeEksR0FBRyxTQUFTO0VBQ2Q7RUFDQSxNQUFNLG1CQUFtQjtHQUFFLElBQUksU0FBUyxRQUFRLE1BQU07UUFBUSxPQUFPO0VBQUc7RUFDeEUsT0FBTyxpQkFBaUIsU0FBUyxPQUFPLEVBQUUsTUFBTSxLQUFLLENBQUM7RUFDdEQsU0FBUyxpQkFBaUIsb0JBQW9CLFVBQVU7RUFDeEQsT0FBTztFQUNQLEtBQUssTUFBTSxDQUFDLE9BQU8sVUFBVSxPQUFPLFFBQVEsR0FBRztHQUM3QyxNQUFNLGVBQWUsT0FBTyxJQUFJLE1BQU0sU0FBUyxRQUFRLEVBQUUsd0VBQXdFLENBQUM7R0FDbEksTUFBTSxlQUFlO0lBQ25CLElBQUksQ0FBQyxNQUFNLGdCQUFnQixDQUFDLE1BQU0sZUFBZTtLQUFFLE9BQU87S0FBRztJQUFRO0lBQ3JFLFFBQVEsT0FBTyxLQUFLO0lBQ3BCLElBQUksQ0FBQyxRQUFRLE1BQU0sT0FBTztHQUM1QjtHQUNBLE1BQU0saUJBQWlCLFFBQVEsTUFBTTtHQUFHLE1BQU0saUJBQWlCLFNBQVMsTUFBTTtHQUM5RSxTQUFTLFdBQVc7SUFBRSxNQUFNLG9CQUFvQixRQUFRLE1BQU07SUFBRyxNQUFNLG9CQUFvQixTQUFTLE1BQU07R0FBRyxDQUFDO0dBQzlHLElBQUksTUFBTSxVQUFVLE9BQU87R0FDM0IsSUFBSSxTQUFTO0VBQ2Y7Q0FDRixDQUFDO0FBQ0giLCJuYW1lcyI6W10sInNvdXJjZXMiOlsicHJldmlldy1pbWFnZXMudHMiXSwidmVyc2lvbiI6Mywic291cmNlc0NvbnRlbnQiOlsiLyoqIFBhZ2VkLmpzIHRvbGVyYXRlcyBpbWFnZSBsb2FkIGZhaWx1cmVzOyBhIHByaW50YWJsZSBwcmV2aWV3IG11c3Qgbm90LiAqL1xuZXhwb3J0IGZ1bmN0aW9uIHdhaXRGb3JQcmV2aWV3SW1hZ2VzKHJvb3Q6IEhUTUxFbGVtZW50LCBzaWduYWw6IEFib3J0U2lnbmFsLCB0aW1lb3V0TXMgPSAxNV8wMDApOiBQcm9taXNlPHZvaWQ+IHtcbiAgaWYgKHNpZ25hbC5hYm9ydGVkKSByZXR1cm4gUHJvbWlzZS5yZWplY3QobmV3IERPTUV4Y2VwdGlvbignUHJldmlldyBjbG9zZWQuJywgJ0Fib3J0RXJyb3InKSk7XG4gIGNvbnN0IGltYWdlcyA9IEFycmF5LmZyb20ocm9vdC5xdWVyeVNlbGVjdG9yQWxsKCdpbWcnKSk7XG4gIGlmICghaW1hZ2VzLmxlbmd0aCkgcmV0dXJuIFByb21pc2UucmVzb2x2ZSgpO1xuICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgIGNvbnN0IHBlbmRpbmcgPSBuZXcgU2V0KGltYWdlcyk7XG4gICAgY29uc3QgY2xlYW51cHM6ICgoKSA9PiB2b2lkKVtdID0gW107XG4gICAgY29uc3QgZG9jdW1lbnQgPSByb290Lm93bmVyRG9jdW1lbnQ7XG4gICAgbGV0IHNldHRsZWQgPSBmYWxzZTtcbiAgICBsZXQgcmVtYWluaW5nID0gdGltZW91dE1zO1xuICAgIGxldCB2aXNpYmxlU2luY2U6IG51bWJlciB8IG51bGwgPSBudWxsO1xuICAgIGxldCB0aW1lcjogUmV0dXJuVHlwZTx0eXBlb2Ygc2V0VGltZW91dD4gfCB1bmRlZmluZWQ7XG4gICAgY29uc3QgcGF1c2UgPSAoKSA9PiB7XG4gICAgICBpZiAodGltZXIgIT09IHVuZGVmaW5lZCkgY2xlYXJUaW1lb3V0KHRpbWVyKTtcbiAgICAgIHRpbWVyID0gdW5kZWZpbmVkO1xuICAgICAgaWYgKHZpc2libGVTaW5jZSAhPT0gbnVsbCkgcmVtYWluaW5nID0gTWF0aC5tYXgoMCwgcmVtYWluaW5nIC0gKHBlcmZvcm1hbmNlLm5vdygpIC0gdmlzaWJsZVNpbmNlKSk7XG4gICAgICB2aXNpYmxlU2luY2UgPSBudWxsO1xuICAgIH07XG4gICAgY29uc3QgZmluaXNoID0gKGVycm9yPzogRXJyb3IpID0+IHtcbiAgICAgIGlmIChzZXR0bGVkKSByZXR1cm47XG4gICAgICBzZXR0bGVkID0gdHJ1ZTsgcGF1c2UoKTtcbiAgICAgIHNpZ25hbC5yZW1vdmVFdmVudExpc3RlbmVyKCdhYm9ydCcsIGFib3J0KTtcbiAgICAgIGRvY3VtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoJ3Zpc2liaWxpdHljaGFuZ2UnLCB2aXNpYmlsaXR5KTtcbiAgICAgIGNsZWFudXBzLmZvckVhY2goY2xlYW51cCA9PiBjbGVhbnVwKCkpO1xuICAgICAgaWYgKGVycm9yKSByZWplY3QoZXJyb3IpOyBlbHNlIHJlc29sdmUoKTtcbiAgICB9O1xuICAgIGNvbnN0IGFib3J0ID0gKCkgPT4gZmluaXNoKG5ldyBET01FeGNlcHRpb24oJ1ByZXZpZXcgY2xvc2VkLicsICdBYm9ydEVycm9yJykpO1xuICAgIC8vIE1hdGNoIHRoZSBvdXRlciBwcmV2aWV3J3MgdmlzaWJsZS10aW1lIGJ1ZGdldC4gQmFja2dyb3VuZCB0YWJzIGNhbiBkZWZlclxuICAgIC8vIGltYWdlIGxvYWRpbmc7IHJldHVybmluZyBtdXN0IHJlc3VtZSB0aGUgdW51c2VkIGJ1ZGdldCwgbm90IHJlc2V0IGl0LlxuICAgIGNvbnN0IHJlc3VtZSA9ICgpID0+IHtcbiAgICAgIGlmIChzZXR0bGVkIHx8IGRvY3VtZW50LmhpZGRlbiB8fCB2aXNpYmxlU2luY2UgIT09IG51bGwpIHJldHVybjtcbiAgICAgIHZpc2libGVTaW5jZSA9IHBlcmZvcm1hbmNlLm5vdygpO1xuICAgICAgdGltZXIgPSBzZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgcGF1c2UoKTtcbiAgICAgICAgaWYgKCFkb2N1bWVudC5oaWRkZW4pIGZpbmlzaChuZXcgRXJyb3IoJ0FuIGltYWdlIGlzIHRha2luZyB0b28gbG9uZyB0byBsb2FkLiBSZXR1cm4gdG8gZWRpdGluZyBhbmQgY2hlY2sgdGhlIGltYWdlcyBiZWZvcmUgcHJpbnRpbmcuJykpO1xuICAgICAgfSwgcmVtYWluaW5nKTtcbiAgICB9O1xuICAgIGNvbnN0IHZpc2liaWxpdHkgPSAoKSA9PiB7IGlmIChkb2N1bWVudC5oaWRkZW4pIHBhdXNlKCk7IGVsc2UgcmVzdW1lKCk7IH07XG4gICAgc2lnbmFsLmFkZEV2ZW50TGlzdGVuZXIoJ2Fib3J0JywgYWJvcnQsIHsgb25jZTogdHJ1ZSB9KTtcbiAgICBkb2N1bWVudC5hZGRFdmVudExpc3RlbmVyKCd2aXNpYmlsaXR5Y2hhbmdlJywgdmlzaWJpbGl0eSk7XG4gICAgcmVzdW1lKCk7XG4gICAgZm9yIChjb25zdCBbaW5kZXgsIGltYWdlXSBvZiBpbWFnZXMuZW50cmllcygpKSB7XG4gICAgICBjb25zdCBmYWlsZWQgPSAoKSA9PiBmaW5pc2gobmV3IEVycm9yKGBJbWFnZSAke2luZGV4ICsgMX0gY291bGQgbm90IGJlIGxvYWRlZC4gUmV0dXJuIHRvIGVkaXRpbmcgYW5kIHJlcGxhY2UgaXQgYmVmb3JlIHByaW50aW5nLmApKTtcbiAgICAgIGNvbnN0IGxvYWRlZCA9ICgpID0+IHtcbiAgICAgICAgaWYgKCFpbWFnZS5uYXR1cmFsV2lkdGggfHwgIWltYWdlLm5hdHVyYWxIZWlnaHQpIHsgZmFpbGVkKCk7IHJldHVybjsgfVxuICAgICAgICBwZW5kaW5nLmRlbGV0ZShpbWFnZSk7XG4gICAgICAgIGlmICghcGVuZGluZy5zaXplKSBmaW5pc2goKTtcbiAgICAgIH07XG4gICAgICBpbWFnZS5hZGRFdmVudExpc3RlbmVyKCdsb2FkJywgbG9hZGVkKTsgaW1hZ2UuYWRkRXZlbnRMaXN0ZW5lcignZXJyb3InLCBmYWlsZWQpO1xuICAgICAgY2xlYW51cHMucHVzaCgoKSA9PiB7IGltYWdlLnJlbW92ZUV2ZW50TGlzdGVuZXIoJ2xvYWQnLCBsb2FkZWQpOyBpbWFnZS5yZW1vdmVFdmVudExpc3RlbmVyKCdlcnJvcicsIGZhaWxlZCk7IH0pO1xuICAgICAgaWYgKGltYWdlLmNvbXBsZXRlKSBsb2FkZWQoKTtcbiAgICAgIGlmIChzZXR0bGVkKSBicmVhaztcbiAgICB9XG4gIH0pO1xufVxuIl19